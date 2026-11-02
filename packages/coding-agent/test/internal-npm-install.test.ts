import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { satisfies } from "semver";
import { afterEach, expect, it, vi } from "vitest";
import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

afterEach(() => vi.unstubAllEnvs());

function hasIntegrationPrerequisites(): boolean {
	try {
		execFileSync("openssl", ["version"], { stdio: "ignore" });
		return satisfies(execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(), ">=11.9.0");
	} catch {
		return false;
	}
}

it.skipIf(!hasIntegrationPrerequisites())(
	"installs a package from a local HTTPS mirror through the restricted proxy",
	async () => {
		const directory = mkdtempSync(join(tmpdir(), "pi-npm-registry-test-"));
		try {
			execFileSync(
				"openssl",
				[
					"req",
					"-x509",
					"-newkey",
					"rsa:2048",
					"-nodes",
					"-keyout",
					join(directory, "key.pem"),
					"-out",
					join(directory, "cert.pem"),
					"-days",
					"1",
					"-subj",
					"/CN=localhost",
				],
				{ stdio: "ignore" },
			);
			const packageDir = join(directory, "package");
			execFileSync("mkdir", [packageDir]);
			writeFileSync(
				join(packageDir, "package.json"),
				JSON.stringify({
					name: "test-plugin",
					version: "1.0.0",
					scripts: { install: "node -e \"require('fs').writeFileSync('LIFECYCLE_RAN','yes')\"" },
				}),
			);
			execFileSync("tar", ["-czf", join(directory, "plugin.tgz"), "-C", directory, "package"]);
			let port = 0;
			const server = createServer(
				{ key: readFileSync(join(directory, "key.pem")), cert: readFileSync(join(directory, "cert.pem")) },
				(req, res) => {
					if (req.url === "/plugin.tgz") {
						res.end(readFileSync(join(directory, "plugin.tgz")));
						return;
					}
					res.setHeader("content-type", "application/json");
					res.end(
						JSON.stringify({
							name: "test-plugin",
							"dist-tags": { latest: "1.0.0" },
							versions: {
								"1.0.0": {
									name: "test-plugin",
									version: "1.0.0",
									dist: { tarball: `https://127.0.0.1:${port}/plugin.tgz` },
								},
							},
						}),
					);
				},
			);
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("missing test server");
			port = address.port;
			try {
				for (const name of [
					"HTTP_PROXY",
					"HTTPS_PROXY",
					"http_proxy",
					"https_proxy",
					"npm_config_proxy",
					"npm_config_https_proxy",
					"NPM_CONFIG_PROXY",
					"NPM_CONFIG_HTTPS_PROXY",
				])
					vi.stubEnv(name, "");
				vi.stubEnv("PI_OFFLINE", "1");
				vi.stubEnv("npm_config_registry", `https://127.0.0.1:${port}/`);
				vi.stubEnv("npm_config_strict_ssl", "false");
				vi.stubEnv("npm_config_fetch_retries", "0");
				vi.stubEnv("NO_PROXY", "*");
				const manager = new DefaultPackageManager({
					cwd: directory,
					agentDir: directory,
					settingsManager: SettingsManager.inMemory(),
				});
				await manager.install("npm:test-plugin");
				expect(existsSync(join(directory, "npm", "node_modules", "test-plugin", "package.json"))).toBe(true);
				expect(existsSync(join(directory, "npm", "node_modules", "test-plugin", "LIFECYCLE_RAN"))).toBe(false);
			} finally {
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	},
	30000,
);
