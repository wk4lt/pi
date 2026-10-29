#!/usr/bin/env node
// Exercise an installed CLI against a local OpenAI-compatible fixture without real credentials or tokens.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { command: { type: "string" } } });
if (!values.command) throw new Error("Usage: node scripts/smoke-company-linux.mjs --command <installed pi command>");
const command = resolve(values.command);
const directory = mkdtempSync(join(tmpdir(), "pi-installed-smoke-"));
const project = join(directory, "business project");
const config = join(directory, "config");
mkdirSync(project);
mkdirSync(config);
writeFileSync(join(project, "input.txt"), "installed-read-ok\n");
const session = join(directory, "session.jsonl");
let requests = 0;
let serverError;
const server = createServer(async (request, response) => {
	try {
		assert.equal(request.url, "/v1/chat/completions");
		assert.equal(request.headers.authorization, "Bearer offline-only");
		let text = "";
		for await (const chunk of request) text += chunk;
		const body = JSON.parse(text);
		assert.equal(body.stream, true);
		const tools = body.messages.filter((message) => message.role === "tool");
		const step = requests++;
		assert.equal(tools.length, step);
		if (step === 1) assert.match(tools[0].content, /installed-read-ok/);
		if (step === 3) assert.ok(tools[2].content.includes(project));
		const calls = [
			{ name: "read", arguments: { path: "input.txt" } },
			{ name: "write", arguments: { path: "output.txt", content: "installed-write-ok\n" } },
			{ name: "bash", arguments: { command: "pwd" } },
		];
		const call = calls[step];
		const delta = call
			? {
					role: "assistant",
					tool_calls: [
						{
							index: 0,
							id: `call_${step}`,
							type: "function",
							function: { name: call.name, arguments: JSON.stringify(call.arguments) },
						},
					],
				}
			: { role: "assistant", content: "installed-task-ok" };
		response.writeHead(200, { "Content-Type": "text/event-stream" });
		for (const [part, finish] of [
			[delta, null],
			[{}, call ? "tool_calls" : "stop"],
		]) {
			response.write(
				`data: ${JSON.stringify({ id: `reply_${step}`, object: "chat.completion.chunk", created: 1, model: "offline-smoke", choices: [{ index: 0, delta: part, finish_reason: finish }] })}\n\n`,
			);
		}
		response.end("data: [DONE]\n\n");
	} catch (error) {
		serverError = error;
		response.writeHead(500);
		response.end("Fixture assertion failed");
	}
});

try {
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	writeFileSync(
		join(config, "models.json"),
		JSON.stringify({
			providers: {
				"offline-smoke": {
					baseUrl: `http://127.0.0.1:${address.port}/v1`,
					api: "openai-completions",
					apiKey: "offline-only",
					authHeader: true,
					models: [{ id: "offline-smoke", contextWindow: 128000, maxTokens: 4096 }],
				},
			},
		}),
	);
	writeFileSync(
		join(config, "settings.json"),
		JSON.stringify({ retry: { enabled: false }, enableInstallTelemetry: false }),
	);
	const child = spawn(
		command,
		[
			"--offline",
			"--no-extensions",
			"--no-mcp",
			"--no-skills",
			"--no-context-files",
			"--no-prompt-templates",
			"--provider",
			"offline-smoke",
			"--model",
			"offline-smoke",
			"--tools",
			"read,write,bash",
			"--session",
			session,
			"-p",
			"Read input.txt, write output.txt, then report the current directory.",
		],
		{
			cwd: project,
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: config,
				PI_OFFLINE: "1",
				PI_TELEMETRY: "0",
				NO_PROXY: "127.0.0.1,localhost",
				no_proxy: "127.0.0.1,localhost",
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let output = "";
	let errors = "";
	child.stdout.on("data", (chunk) => {
		output += chunk;
	});
	child.stderr.on("data", (chunk) => {
		errors += chunk;
	});
	const timeout = setTimeout(() => child.kill("SIGKILL"), 30000);
	try {
		const code = await new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("close", resolve);
		});
		if (serverError) throw serverError;
		assert.equal(code, 0, errors);
		assert.equal(requests, 4, `${output}\n${errors}`);
		assert.match(output, /installed-task-ok/);
		assert.equal(readFileSync(join(project, "output.txt"), "utf8"), "installed-write-ok\n");
		assert.match(readFileSync(session, "utf8"), /installed-task-ok/);
		console.log(
			"Installed CLI passed: local API streaming, read, write, Bash working directory, and session persistence.",
		);
	} finally {
		clearTimeout(timeout);
	}
} finally {
	await new Promise((resolve) => server.close(resolve));
	rmSync(directory, { recursive: true, force: true });
}
