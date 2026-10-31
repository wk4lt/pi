#!/usr/bin/env node
// Build and verify the Linux package using the company npm registry and local Node.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getPublicWorkspacePackages } from "./release-packages.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { out: { type: "string" }, help: { type: "boolean" } } });
if (values.help) {
	console.log("Usage: npm run package:linux [-- --out <new directory>]\nUses local Node >=22.19.0 and an explicitly configured company npm registry. Requires Linux, npm, tar, Bash and GNU coreutils.");
	process.exit(0);
}
if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch)) throw new Error("Build on Linux x64 or arm64.");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 19)) throw new Error("Node >=22.19.0 is required.");
const npm = process.env.npm_execpath;
if (!npm || !existsSync(npm)) throw new Error("Run with npm run package:linux to locate npm.");
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: repoRoot, stdio: "inherit", ...options });
const registry = execFileSync(process.execPath, [npm, "config", "get", "registry"], { cwd: repoRoot, encoding: "utf8" }).trim();
const registryUrl = new URL(registry);
if (registryUrl.protocol !== "https:" || registryUrl.hostname === "registry.npmjs.org" || registryUrl.username || registryUrl.password) {
	throw new Error("Configure npm registry to an HTTPS company mirror before building.");
}
// Only the default npm registry and the configured company host can appear in reviewed locks.
const scopes = new Set(["earendil-works"]);
for (const file of ["package-lock.json", "packages/coding-agent/install-lock/package-lock.json"]) {
	const lock = JSON.parse(readFileSync(join(repoRoot, file), "utf8"));
	for (const [name, entry] of Object.entries(lock.packages ?? {})) {
		const match = name.match(/(?:^|node_modules\/)@([^/]+)\//);
		if (match) scopes.add(match[1]);
		if (entry.resolved && /^https?:/.test(entry.resolved)) {
			const host = new URL(entry.resolved).hostname;
			if (host !== "registry.npmjs.org" && host !== registryUrl.hostname) throw new Error(`External lockfile source in ${file}: ${host}`);
		} else if (entry.resolved && /^(?:git|ssh|https?:)/.test(entry.resolved)) {
			throw new Error(`Unsupported dependency source in ${file}: ${entry.resolved}`);
		}
	}
}
const npmFlags = [`--registry=${registry}`, ...[...scopes].map((scope) => `--@${scope}:registry=${registry}`)];
const env = { ...process.env, npm_config_registry: registry, npm_config_replace_registry_host: "always" };
for (const scope of scopes) env[`npm_config_@${scope}:registry`] = registry;
const npmRun = (args, options = {}) => run(process.execPath, [npm, ...args, ...npmFlags], { env, ...options });
const artifactRoot = join(repoRoot, ".artifacts");
const outputRoot = join(artifactRoot, "company-linux");
mkdirSync(outputRoot, { recursive: true });
const lockPath = join(artifactRoot, "company-build.lock");
try { mkdirSync(lockPath); } catch (error) {
	if (error.code === "EEXIST") throw new Error(`Another build may be active. Check ${lockPath} before retrying.`);
	throw error;
}
writeFileSync(join(lockPath, "pid"), `${process.pid}\n`);
let stage;
try {
	stage = mkdtempSync(join(tmpdir(), "pi-company-build-"));
	console.log("[1/5] Installing locked dependencies from the company registry");
	npmRun(["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
	console.log("[2/5] Preparing model data from the company registry");
	const version = JSON.parse(readFileSync(join(repoRoot, "packages/ai/package.json"), "utf8")).version;
	const packed = JSON.parse(execFileSync(process.execPath, [npm, "pack", `@earendil-works/pi-ai@${version}`, "--ignore-scripts", "--json", "--pack-destination", stage, ...npmFlags], { cwd: stage, env, encoding: "utf8" }));
	if (packed.length !== 1 || packed[0].name !== "@earendil-works/pi-ai" || packed[0].version !== version || basename(packed[0].filename) !== packed[0].filename) throw new Error("Unexpected model data package.");
	run("tar", ["-xzf", join(stage, packed[0].filename), "-C", stage, "package/dist/providers/data"]);
	const dataDir = join(repoRoot, "packages/ai/src/providers/data");
	const dataBackup = join(repoRoot, `packages/ai/src/providers/.data-backup-${process.pid}`);
	if (existsSync(dataBackup)) throw new Error(`Unexpected model data backup: ${dataBackup}`);
	if (existsSync(dataDir)) renameSync(dataDir, dataBackup);
	try {
		cpSync(join(stage, "package/dist/providers/data"), dataDir, { recursive: true });
		npmRun(["run", "check:model-data"]);
		rmSync(dataBackup, { recursive: true, force: true });
	} catch (error) {
		rmSync(dataDir, { recursive: true, force: true });
		if (existsSync(dataBackup)) renameSync(dataBackup, dataDir);
		throw error;
	}
	console.log("[3/5] Compiling and testing installer");
	const workspaces = getPublicWorkspacePackages(join(repoRoot, "packages")).map((pkg) => `--workspace=${pkg.name}`);
	npmRun(["run", "clean", "--if-present", ...workspaces]);
	npmRun(["run", "build:offline"]);
	run(process.execPath, ["--test", "scripts/company-linux.test.mjs"], { env });
	console.log("[4/5] Creating the installation package");
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const output = values.out ? resolve(values.out) : join(outputRoot, `build-${stamp}-${basename(stage)}`);
	run(process.execPath, ["scripts/package-company-linux.mjs", "--node", realpathSync(process.execPath), "--npm", npm, "--out", output], { env });
	const cliVersion = JSON.parse(readFileSync(join(repoRoot, "packages/coding-agent/package.json"), "utf8")).version;
	const name = `company-pi-${cliVersion}-linux-${process.arch}`;
	const archive = join(output, `${name}.tar.gz`);
	run("sha256sum", ["--check", `${name}.tar.gz.sha256`], { cwd: output });
	console.log("[5/5] Verifying installation outside the source tree");
	const unpacked = join(stage, "unpacked");
	mkdirSync(unpacked);
	run("tar", ["-xzf", archive, "-C", unpacked]);
	const bin = join(stage, "commands");
	run("bash", [join(unpacked, name, "install.sh"), "--prefix", join(stage, "installed"), "--bin-dir", bin], { cwd: stage });
	run(process.execPath, ["scripts/smoke-company-linux.mjs", "--command", join(bin, "pi")], { env });
	const latest = { archive, checksum: `${archive}.sha256`, version: cliVersion, arch: process.arch, verifiedAt: new Date().toISOString() };
	const temporary = join(outputRoot, `latest-${process.pid}.json`);
	writeFileSync(temporary, `${JSON.stringify(latest, null, "\t")}\n`);
	renameSync(temporary, join(outputRoot, "latest.json"));
	console.log(`\nVerified installation package: ${archive}`);
} finally {
	if (stage) rmSync(stage, { recursive: true, force: true });
	rmSync(lockPath, { recursive: true, force: true });
}
