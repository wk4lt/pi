import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAuthPath, getModelsPath } from "../config.ts";
import { AuthStorage } from "./auth-storage.ts";

export interface GatewayModel {
	id: string;
	contextWindow?: number;
	maxTokens?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeGatewayUrl(baseUrl: string): string {
	let url: URL;
	try {
		url = new URL(baseUrl.trim());
	} catch {
		throw new Error("请输入有效的网关基础地址。");
	}
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
		throw new Error("网关地址必须是 HTTP(S) 基础地址，不能包含账号、密码或查询参数。");
	}
	if (url.pathname === "/") url.pathname = "/v1";
	return url.toString().replace(/\/+$/, "");
}

/** Discover models from the user-selected gateway, without following redirects with credentials. */
export async function discoverGatewayModels(
	baseUrl: string,
	apiKey: string,
	signal?: AbortSignal,
): Promise<GatewayModel[]> {
	const url = normalizeGatewayUrl(baseUrl);
	if (!apiKey.trim()) throw new Error("API Key 不能为空。");
	let response: Response;
	try {
		response = await fetch(`${url}/models`, {
			headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: "application/json" },
			redirect: "manual",
			signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
		});
	} catch {
		if (signal?.aborted) throw new Error("Login cancelled");
		throw new Error("无法连接网关或请求超时。");
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(
			response.status === 401 || response.status === 403
				? "网关认证失败，请检查 API Key。"
				: `模型列表请求失败（HTTP ${response.status}）。`,
		);
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new Error("网关返回的模型列表不是有效 JSON。");
	}
	if (!isRecord(payload) || !Array.isArray(payload.data) || payload.has_more === true) {
		throw new Error("网关模型列表格式不受支持或存在未获取的分页。");
	}
	const models: GatewayModel[] = [];
	const seen = new Set<string>();
	for (const item of payload.data) {
		if (!isRecord(item) || typeof item.id !== "string") continue;
		const id = item.id.trim();
		if (!id || id.length > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(id) || seen.has(id)) continue;
		if (typeof item.type === "string" && ["embedding", "image", "audio"].includes(item.type.toLowerCase())) continue;
		const contextWindow =
			Number.isSafeInteger(item.context_window) && (item.context_window as number) > 0
				? (item.context_window as number)
				: undefined;
		const maxTokens =
			Number.isSafeInteger(item.max_output_tokens) &&
			(item.max_output_tokens as number) > 0 &&
			(!contextWindow || (item.max_output_tokens as number) <= contextWindow)
				? (item.max_output_tokens as number)
				: undefined;
		models.push({ id, ...(contextWindow ? { contextWindow } : {}), ...(maxTokens ? { maxTokens } : {}) });
		seen.add(id);
	}
	if (models.length === 0) throw new Error("网关未返回可用的模型名称。");
	return models;
}

/** Merge discovered models without replacing existing settings or writing the key to models.json. */
export async function saveCompanyGateway(
	baseUrl: string,
	modelId: string,
	apiKey: string,
	discovered: GatewayModel[] = [],
): Promise<string> {
	const url = normalizeGatewayUrl(baseUrl);
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
	const existing = Object.entries(providers).find(
		([id, provider]) =>
			/^company-gateway(?:-\d+)?$/.test(id) &&
			isRecord(provider) &&
			provider.baseUrl === url &&
			provider.api === "openai-completions" &&
			provider.authHeader === true &&
			Array.isArray(provider.models),
	);
	let providerId = existing?.[0] ?? "company-gateway";
	if (!existing) {
		const occupied = new Set((await credentials.list()).map((entry) => entry.providerId));
		for (let index = 2; Object.hasOwn(providers, providerId) || occupied.has(providerId); index++)
			providerId = `company-gateway-${index}`;
	}
	const provider =
		existing && isRecord(existing[1])
			? existing[1]
			: { baseUrl: url, api: "openai-completions", authHeader: true, models: [] };
	const models = provider.models as unknown[];
	const ids = new Set(models.flatMap((model) => (isRecord(model) && typeof model.id === "string" ? [model.id] : [])));
	for (const model of [...discovered, { id: modelId.trim() }]) {
		if (!ids.has(model.id)) {
			models.push(model);
			ids.add(model.id);
		}
	}
	providers[providerId] = provider;
	const escapedKey = apiKey
		.trim()
		.replace(/\$/g, () => "$$")
		.replace(/^!/, () => "$!");
	let previous: Awaited<ReturnType<typeof credentials.read>>;
	await credentials.modify(providerId, async (current) => {
		previous = current;
		return { type: "api_key", key: escapedKey };
	});
	const parent = dirname(configPath);
	mkdirSync(parent, { recursive: true, mode: 0o700 });
	const temporary = join(parent, `.models-${randomUUID()}.tmp`);
	try {
		writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
		renameSync(temporary, configPath);
	} catch (error) {
		if (previous) await credentials.modify(providerId, async () => previous);
		else await credentials.delete(providerId);
		throw error;
	} finally {
		rmSync(temporary, { force: true });
	}
	return providerId;
}
