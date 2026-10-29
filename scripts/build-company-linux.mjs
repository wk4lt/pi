#!/usr/bin/env node
// Prepare pinned inputs, compile source, package Linux, and verify a fresh install in one command.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cacheCompanyAsset } from "./company-linux-assets.mjs";
import { getPublicWorkspacePackages } from "./release-packages.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { out: { type: "string" }, help: { type: "boolean" } } });
if (values.help) {
	console.log(
		"Usage: npm run package:linux [-- --out <new directory>]\nPrepares pinned assets, installs dependencies, checks, compiles, packages and verifies a Linux install.\nRequires Linux, Node.js 18+ to bootstrap, curl, tar, Bash and GNU coreutils.",
	);
	process.exit(0);
}
if (process.platform !== "linux") throw new Error("Run this command on Linux for the target architecture.");
const assets = JSON.parse(readFileSync(join(repoRoot, "scripts/company-linux/assets.json"), "utf8"));
const platformAssets = assets.platforms[process.arch];
if (!platformAssets) throw new Error(`Unsupported architecture: ${process.arch}`);
const nodeVersion = readFileSync(join(repoRoot, ".node-version"), "utf8").trim();
if (nodeVersion !== assets.nodeVersion) throw new Error("Update the pinned build assets to match .node-version.");

const artifactRoot = join(repoRoot, ".artifacts");
const outputRoot = join(artifactRoot, "company-linux");
const cache = join(artifactRoot, "company-cache");
mkdirSync(outputRoot, { recursive: true });
const lockPath = join(artifactRoot, "company-build.lock");
try {
	mkdirSync(lockPath);
} catch (error) {
	if (error.code === "EEXIST") throw new Error(`Another build may be active. Check ${lockPath} before retrying.`);
	throw error;
}
writeFileSync(join(lockPath, "pid"), `${process.pid}\n`);
const stage = mkdtempSync(join(tmpdir(), "pi-company-build-"));

try {
	const revision = JSON.parse(readFileSync(join(repoRoot, "nix/model-catalog.json"), "utf8")).revision;
	const catalog = {
		filename: `models-${revision}.json`,
		url: `https://pi.dev/api/models/revisions/${revision}?types=chat,image,classifier`,
		sha256: revision.replace(/^sha256-/, ""),
	};
	console.log("[1/5] Preparing pinned Node, search tools and model catalog");
	const [nodeArchive, fdArchive, rgArchive, catalogPath] = await Promise.all(
		[platformAssets.node, platformAssets.fd, platformAssets.rg, catalog].map((asset) =>
			cacheCompanyAsset(asset, cache),
		),
	);
	const runtime = join(stage, "runtime");
	const tools = join(stage, "tools");
	for (const [archive, directory] of [
		[nodeArchive, runtime],
		[fdArchive, join(tools, "fd-release")],
		[rgArchive, join(tools, "rg-release")],
	]) {
		mkdirSync(directory, { recursive: true });
		execFileSync("tar", ["-xf", archive, "-C", directory, "--strip-components=1"], { stdio: "inherit" });
	}
	cpSync(join(tools, "fd-release/fd"), join(tools, "fd"));
	cpSync(join(tools, "rg-release/rg"), join(tools, "rg"));
	const node = join(runtime, "bin/node");
	const env = { ...process.env, PATH: `${join(runtime, "bin")}:${process.env.PATH ?? ""}` };
	const run = (command, args, cwd = repoRoot) => execFileSync(command, args, { cwd, env, stdio: "inherit" });
	const npm = (args) => run(node, [join(runtime, "lib/node_modules/npm/bin/npm-cli.js"), ...args]);

	console.log("[2/5] Installing locked development dependencies and checking source");
	npm(["ci", "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund"]);
	run(node, ["packages/ai/scripts/hydrate-model-catalog.ts", catalogPath]);
	npm(["run", "check"]);
	run(node, ["--test", "scripts/company-linux-assets.test.mjs", "scripts/company-linux.test.mjs"]);

	console.log("[3/5] Cleaning generated output and compiling current source");
	const workspaces = getPublicWorkspacePackages(join(repoRoot, "packages")).map((pkg) => `--workspace=${pkg.name}`);
	npm(["run", "clean", "--if-present", ...workspaces]);
	npm(["run", "build:offline"]);

	console.log("[4/5] Creating the offline installation package");
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const output = values.out ? resolve(values.out) : join(outputRoot, `build-${stamp}-${basename(stage)}`);
	run(node, ["scripts/package-company-linux.mjs", "--runtime", runtime, "--tools", tools, "--out", output]);
	const version = JSON.parse(readFileSync(join(repoRoot, "packages/coding-agent/package.json"), "utf8")).version;
	const name = `company-pi-${version}-linux-${process.arch}`;
	const archive = join(output, `${name}.tar.gz`);
	run("sha256sum", ["--check", `${name}.tar.gz.sha256`], output);

	console.log("[5/5] Verifying an extracted installation outside the source tree");
	const unpacked = join(stage, "unpacked");
	mkdirSync(unpacked);
	run("tar", ["-xzf", archive, "-C", unpacked]);
	const prefix = join(stage, "installed");
	const bin = join(stage, "commands");
	run("bash", [join(unpacked, name, "install.sh"), "--prefix", prefix, "--bin-dir", bin], stage);
	run(node, ["scripts/smoke-company-linux.mjs", "--command", join(bin, "pi")]);
	const latest = {
		archive,
		checksum: `${archive}.sha256`,
		version,
		arch: process.arch,
		verifiedAt: new Date().toISOString(),
	};
	const latestTemporary = join(outputRoot, `latest-${process.pid}.json`);
	writeFileSync(latestTemporary, `${JSON.stringify(latest, null, "\t")}\n`);
	renameSync(latestTemporary, join(outputRoot, "latest.json"));
	console.log(`\nVerified installation package: ${archive}\nLatest result: ${join(outputRoot, "latest.json")}`);
} finally {
	rmSync(stage, { recursive: true, force: true });
	rmSync(lockPath, { recursive: true, force: true });
}
