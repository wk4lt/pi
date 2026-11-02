import { execFile } from "node:child_process";
import { createServer as createHttpServer, request } from "node:http";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { withRegistryProxy } from "../src/core/internal-npm-proxy.ts";

describe("internal npm proxy", () => {
	it("does not let npm bypass the proxy through no_proxy", async () => {
		let hits = 0;
		const target = createHttpServer((_req, res) => {
			hits++;
			res.end("{}");
		});
		await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
		const address = target.address();
		if (!address || typeof address === "string") throw new Error("missing test server");
		try {
			await withRegistryProxy(new URL("https://registry.invalid"), undefined, async (proxy) => {
				await expect(
					promisify(execFile)(
						"npm",
						[
							"view",
							"example",
							`--registry=http://127.0.0.1:${address.port}`,
							`--proxy=${proxy}`,
							`--https-proxy=${proxy}`,
							"--noproxy=",
							"--fetch-retries=0",
						],
						{
							env: {
								...process.env,
								NO_PROXY: "",
								no_proxy: "",
								NOPROXY: "",
								noproxy: "",
								npm_config_noproxy: "",
							},
						},
					),
				).rejects.toThrow();
				expect(hits).toBe(0);
			});
		} finally {
			target.close();
		}
	});
	it("only permits CONNECT to the configured registry host and port", async () => {
		const target = createServer((socket) => socket.on("data", (data) => socket.write(data)));
		await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
		const address = target.address();
		if (!address || typeof address === "string") throw new Error("missing test server");
		try {
			await withRegistryProxy(new URL(`https://127.0.0.1:${address.port}`), undefined, async (proxy) => {
				const connect = (host: string) =>
					new Promise<number>((resolve, reject) => {
						const call = request(proxy, { method: "CONNECT", path: host });
						call.on("connect", (response, socket) => {
							socket.destroy();
							resolve(response.statusCode ?? 0);
						});
						call.on("error", reject);
						call.end();
					});
				expect(await connect(`127.0.0.1:${address.port}`)).toBe(200);
				expect(await connect(`example.invalid:${address.port}`)).toBe(403);
				expect(await connect("127.0.0.1:12345")).toBe(403);
			});
		} finally {
			target.close();
		}
	});
});
