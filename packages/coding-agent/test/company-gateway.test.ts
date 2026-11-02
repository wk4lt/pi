import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveCompanyGateway } from "../src/core/company-gateway.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

const previousDir = process.env.PI_CODING_AGENT_DIR;
const directories: string[] = [];
function setup(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-gateway-test-"));
	directories.push(dir);
	process.env.PI_CODING_AGENT_DIR = dir;
	return dir;
}
afterEach(() => {
	if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousDir;
	for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("company gateway login configuration", () => {
	it("preserves existing models and stores a key separately", async () => {
		const dir = setup();
		writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { existing: { api: "example" } } }));
		const id = await saveCompanyGateway("http://gateway.invalid/v1", "internal-model", "test-secret");
		expect(id).toBe("company-gateway");
		const text = readFileSync(join(dir, "models.json"), "utf8");
		expect(text).not.toContain("test-secret");
		const config = JSON.parse(text);
		expect(config.providers.existing.api).toBe("example");
		expect(config.providers[id]).toMatchObject({
			baseUrl: "http://gateway.invalid/v1",
			api: "openai-completions",
			authHeader: true,
			models: [{ id: "internal-model" }],
		});
		expect(JSON.parse(readFileSync(join(dir, "auth.json"), "utf8"))[id]).toEqual({
			type: "api_key",
			key: "test-secret",
		});
		if (process.platform !== "win32") expect(statSync(join(dir, "auth.json")).mode & 0o777).toBe(0o600);
		const runtime = await ModelRuntime.create({
			modelsPath: join(dir, "models.json"),
			authPath: join(dir, "auth.json"),
			allowModelNetwork: false,
		});
		const model = runtime.getModel(id, "internal-model");
		expect(model).toBeDefined();
		expect((await runtime.getAuth(model!))?.auth.apiKey).toBe("test-secret");
		const requests: Request[] = [];
		const fetch: typeof globalThis.fetch = async (input, init) => {
			requests.push(new Request(input, init));
			const chunk = {
				id: "mock",
				object: "chat.completion.chunk",
				created: 0,
				model: "internal-model",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			};
			return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
		};
		const response = await runtime.completeSimple(model!, { messages: [] }, { fetch });
		expect(response.stopReason).toBe("stop");
		expect(requests).toHaveLength(1);
		expect(requests[0]!.url).toBe("http://gateway.invalid/v1/chat/completions");
		expect(requests[0]!.headers.get("authorization")).toBe("Bearer test-secret");
	});
	it("treats a pasted key as a literal, not a shell command or environment expression", async () => {
		const dir = setup();
		const id = await saveCompanyGateway("https://gateway.invalid/v1", "new", "!literal$VARIABLE");
		const runtime = await ModelRuntime.create({
			modelsPath: join(dir, "models.json"),
			authPath: join(dir, "auth.json"),
			allowModelNetwork: false,
		});
		const model = runtime.getModel(id, "new");
		expect(model).toBeDefined();
		expect((await runtime.getAuth(model!))?.auth.apiKey).toBe("!literal$VARIABLE");
	});
	it.skipIf(process.platform === "win32")("refuses to store keys in a world-readable credential file", async () => {
		const dir = setup();
		writeFileSync(join(dir, "auth.json"), "{}");
		chmodSync(join(dir, "auth.json"), 0o644);
		await expect(saveCompanyGateway("https://gateway.invalid/v1", "new", "key")).rejects.toThrow("权限过宽");
		expect(readFileSync(join(dir, "auth.json"), "utf8")).toBe("{}");
	});
	it("does not overwrite an existing provider", async () => {
		const dir = setup();
		writeFileSync(
			join(dir, "models.json"),
			JSON.stringify({ providers: { "company-gateway": { api: "existing" } } }),
		);
		expect(await saveCompanyGateway("https://gateway.invalid/v1", "new", "key")).toBe("company-gateway-2");
		expect(JSON.parse(readFileSync(join(dir, "models.json"), "utf8")).providers["company-gateway"].api).toBe(
			"existing",
		);
	});
	it("does not modify invalid or commented JSON and rejects credential-bearing URLs", async () => {
		const dir = setup();
		const raw = '{ // keep comments\n "providers": {}\n}';
		writeFileSync(join(dir, "models.json"), raw);
		await expect(saveCompanyGateway("https://gateway.invalid/v1", "model", "key")).rejects.toThrow();
		expect(readFileSync(join(dir, "models.json"), "utf8")).toBe(raw);
		await expect(saveCompanyGateway("https://user:secret@gateway.invalid/v1", "model", "key")).rejects.toThrow();
	});
});
