import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverGatewayModels, saveCompanyGateway } from "../src/core/company-gateway.ts";
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
	vi.unstubAllGlobals();
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

describe("gateway model discovery", () => {
	it("uses the gateway Bearer key, parses metadata, and does not follow redirects", async () => {
		const fetch = vi.fn(async () =>
			Response.json({
				data: [
					{ id: "chat-a", context_window: 131072, max_output_tokens: 8192 },
					{ id: "chat-b" },
					{ id: "chat-a" },
					{ id: "vectors", type: "embedding" },
				],
			}),
		);
		vi.stubGlobal("fetch", fetch);
		expect(await discoverGatewayModels("https://gateway.invalid/v1/", "test-key")).toEqual([
			{ id: "chat-a", contextWindow: 131072, maxTokens: 8192 },
			{ id: "chat-b" },
		]);
		expect(fetch).toHaveBeenCalledWith(
			"https://gateway.invalid/v1/models",
			expect.objectContaining({
				headers: { Authorization: "Bearer test-key", Accept: "application/json" },
				redirect: "manual",
			}),
		);
	});
	it("adds /v1 for an origin and rejects failed auth, redirects, empty and paginated responses", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response("", { status: 401 }))
			.mockResolvedValueOnce(
				new Response(null, { status: 302, headers: { location: "https://elsewhere.invalid/" } }),
			)
			.mockResolvedValueOnce(Response.json({ data: [] }))
			.mockResolvedValueOnce(Response.json({ data: [{ id: "m" }], has_more: true }));
		vi.stubGlobal("fetch", fetch);
		await expect(discoverGatewayModels("https://gateway.invalid", "key")).rejects.toThrow("认证失败");
		expect(fetch.mock.calls[0]![0]).toBe("https://gateway.invalid/v1/models");
		await expect(discoverGatewayModels("https://gateway.invalid", "key")).rejects.toThrow("HTTP 302");
		await expect(discoverGatewayModels("https://gateway.invalid", "key")).rejects.toThrow("未返回");
		await expect(discoverGatewayModels("https://gateway.invalid", "key")).rejects.toThrow("分页");
	});
	it("discovers from the configured gateway even when public catalog refresh is disabled", async () => {
		vi.stubEnv("PI_OFFLINE", "1");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [{ id: "internal-model" }] })),
		);
		try {
			expect(await discoverGatewayModels("http://gateway.invalid/v1", "key")).toEqual([{ id: "internal-model" }]);
		} finally {
			vi.unstubAllEnvs();
		}
	});
	it("reports connection failure and cancellation without exposing credentials", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("secret transport detail");
			}),
		);
		await expect(discoverGatewayModels("https://gateway.invalid/v1", "test-secret")).rejects.toThrow("无法连接网关");
		const controller = new AbortController();
		controller.abort();
		await expect(
			discoverGatewayModels("https://gateway.invalid/v1", "test-secret", controller.signal),
		).rejects.toThrow("Login cancelled");
	});
	it("reuses the same gateway and preserves existing model settings when refreshing", async () => {
		const dir = setup();
		const base = "https://gateway.invalid/v1";
		const first = await saveCompanyGateway(base, "old", "key1", [{ id: "old", contextWindow: 32768 }]);
		const configPath = join(dir, "models.json");
		const config = JSON.parse(readFileSync(configPath, "utf8"));
		config.providers[first].models[0].contextWindow = 64000;
		writeFileSync(configPath, JSON.stringify(config));
		const second = await saveCompanyGateway(base, "new", "key2", [
			{ id: "old", contextWindow: 1000 },
			{ id: "new", maxTokens: 4096 },
		]);
		expect(second).toBe(first);
		const updated = JSON.parse(readFileSync(configPath, "utf8"));
		expect(updated.providers[first].models).toEqual([
			{ id: "old", contextWindow: 64000 },
			{ id: "new", maxTokens: 4096 },
		]);
		expect(JSON.parse(readFileSync(join(dir, "auth.json"), "utf8"))[first].key).toBe("key2");
	});
});
