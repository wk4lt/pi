import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAuthPath, getModelsPath } from "../config.ts";
import { AuthStorage } from "./auth-storage.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Save a new internal provider without replacing existing providers or writing its key to models.json. */
export async function saveCompanyGateway(baseUrl: string, modelId: string, apiKey: string): Promise<string> {
	const url = new URL(baseUrl.trim());
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
		throw new Error("网关地址必须是 HTTP(S) 基础地址，不能包含账号、密码或查询参数。");
	}
	if (!modelId.trim() || !apiKey.trim()) throw new Error("模型名称和 API Key 不能为空。");
	const configPath = getModelsPath();
	let config: Record<string, unknown> = { providers: {} };
	if (existsSync(configPath)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(configPath, "utf8"));
		} catch {
			throw new Error("现有 models.json 不是标准 JSON，未修改文件；请手动配置网关。");
		}
		if (!isRecord(parsed) || !isRecord(parsed.providers)) throw new Error("现有 models.json 格式无效，未修改文件。");
		config = parsed;
	}
	const providers = config.providers as Record<string, unknown>;
	const authPath = getAuthPath();
	if (process.platform !== "win32" && existsSync(authPath) && (statSync(authPath).mode & 0o077) !== 0) {
		throw new Error("auth.json 权限过宽，请先将权限收紧为 600。");
	}
	const credentials = AuthStorage.create(authPath);
	let providerId = "company-gateway";
	for (
		let index = 2;
		Object.hasOwn(providers, providerId) || (await credentials.read(providerId)) !== undefined;
		index++
	) {
		providerId = `company-gateway-${index}`;
	}
	providers[providerId] = {
		baseUrl: url.toString().replace(/\/$/, ""),
		api: "openai-completions",
		authHeader: true,
		models: [{ id: modelId.trim() }],
	};
	// Credentials use the existing locked auth store, which creates auth.json with mode 0600.
	// The credential store interprets $VARIABLE and leading ! as config expressions.
	// Escape those characters so a pasted key is always treated literally.
	const escapedKey = apiKey
		.trim()
		.replace(/\$/g, () => "$$")
		.replace(/^!/, () => "$!");
	await credentials.modify(providerId, async () => ({ type: "api_key", key: escapedKey }));
	const parent = dirname(configPath);
	mkdirSync(parent, { recursive: true, mode: 0o700 });
	const temporary = join(parent, `.models-${randomUUID()}.tmp`);
	try {
		writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
		renameSync(temporary, configPath);
	} catch (error) {
		await credentials.delete(providerId);
		throw error;
	} finally {
		rmSync(temporary, { force: true });
	}
	return providerId;
}
