#!/usr/bin/env node
// Package the built company CLI with a pinned Node runtime and installed production dependencies.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { produceArtifactSet } from "./package-artifacts.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
	options: {
		runtime: { type: "string" },
		tools: { type: "string" },
		out: { type: "string", default: join(repoRoot, ".artifacts/company-linux") },
		help: { type: "boolean" },
	},
});
if (values.help) {
	console.log(
		"Usage: node scripts/package-company-linux.mjs --runtime <Node 22.19.0 directory> --tools <fd/rg directory with licenses> [--out <new directory>]\nRun npm run build:offline first. Builds a Linux package for the current architecture.",
	);
	process.exit(0);
}
if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch)) {
	throw new Error("Build on Linux x64 or arm64 for the same target architecture.");
}
if (!values.runtime) throw new Error("--runtime is required");
if (!values.tools) throw new Error("--tools is required");

const tools = resolve(values.tools);
const toolVersions = {};
for (const [tool, expected] of [
	["fd", "fd 10.3.0"],
	["rg", "ripgrep 14.1.1 (rev 4649aa9700)"],
]) {
	const version = execFileSync(join(tools, tool), ["--version"], { encoding: "utf8" }).split("\n")[0];
	if (version !== expected) throw new Error(`Expected ${expected}, got ${version}`);
	toolVersions[tool] = version;
}

const runtime = resolve(values.runtime);
const node = join(runtime, "bin/node");
const expectedNode = readFileSync(join(repoRoot, ".node-version"), "utf8").trim();
if (process.versions.node !== expectedNode) throw new Error(`Run the packager with Node ${expectedNode}.`);
const runtimeInfo = JSON.parse(
	execFileSync(
		node,
		["-p", "JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch})"],
		{ encoding: "utf8" },
	),
);
if (runtimeInfo.version !== expectedNode || runtimeInfo.platform !== "linux" || runtimeInfo.arch !== process.arch) {
	throw new Error(`Expected Linux ${process.arch} Node ${expectedNode}, got ${JSON.stringify(runtimeInfo)}`);
}
if (!existsSync(join(repoRoot, "packages/coding-agent/dist/bundle/cli.js"))) {
	throw new Error("Build output is missing. Run npm run build:offline first.");
}
const output = resolve(values.out);
if (existsSync(output)) throw new Error(`Output already exists; choose a new --out directory: ${output}`);
mkdirSync(output, { recursive: true });

const env = { ...process.env, PATH: `${join(runtime, "bin")}:${process.env.PATH ?? ""}` };
const artifacts = produceArtifactSet({ repoRoot, outDir: join(output, "packages"), build: false });
const installLockDir = join(repoRoot, "packages/coding-agent/install-lock");
const manifest = JSON.parse(readFileSync(join(installLockDir, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(installLockDir, "package-lock.json"), "utf8"));
const name = `company-pi-${manifest.version}-linux-${process.arch}`;
const payload = join(output, name);
const app = join(payload, "app");
mkdirSync(join(app, "tarballs"), { recursive: true });

// Change only local workspace tarball locations; external resolutions retain the reviewed install lock.
for (const pkg of artifacts.packages) {
	const entry = lock.packages[`node_modules/${pkg.name}`];
	if (!entry) continue;
	if (entry.version !== pkg.version) throw new Error(`Install lock version mismatch for ${pkg.name}`);
	const filename = basename(pkg.tarballPath);
	cpSync(pkg.tarballPath, join(app, "tarballs", filename));
	entry.resolved = `file:tarballs/${filename}`;
	entry.integrity = pkg.integrity;
}
writeFileSync(join(app, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
writeFileSync(join(app, "package-lock.json"), `${JSON.stringify(lock, null, "\t")}\n`);
execFileSync(
	node,
	[
		join(runtime, "lib/node_modules/npm/bin/npm-cli.js"),
		"ci",
		"--ignore-scripts",
		"--omit=dev",
		"--no-audit",
		"--no-fund",
	],
	{
		cwd: app,
		env,
		stdio: "inherit",
	},
);

cpSync(runtime, join(payload, "runtime"), { recursive: true });
cpSync(tools, join(payload, "tools"), { recursive: true });
mkdirSync(join(payload, "bin"));
cpSync(join(repoRoot, "scripts/company-linux/pi"), join(payload, "bin/pi"));
cpSync(join(repoRoot, "scripts/company-linux/install.sh"), join(payload, "install.sh"));
cpSync(join(repoRoot, "scripts/company-linux/README.md"), join(payload, "README.md"));
cpSync(join(repoRoot, "LICENSE"), join(payload, "LICENSE"));
writeFileSync(
	join(payload, "distribution.json"),
	`${JSON.stringify(
		{
			product: "company-pi",
			version: manifest.version,
			platform: "linux",
			arch: process.arch,
			node: expectedNode,
			tools: toolVersions,
			source: artifacts.source,
			modelCatalog: JSON.parse(readFileSync(join(repoRoot, "nix/model-catalog.json"), "utf8")).revision,
		},
		null,
		"\t",
	)}\n`,
);

const checksums = [];
function collectChecksums(directory, relativeDirectory = ".") {
	for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		const path = join(directory, entry.name);
		const relativePath = `${relativeDirectory}/${entry.name}`;
		if (entry.isDirectory()) collectChecksums(path, relativePath);
		else if (entry.isFile())
			checksums.push(`${createHash("sha256").update(readFileSync(path)).digest("hex")}  ${relativePath}`);
	}
}
collectChecksums(payload);
writeFileSync(join(payload, "SHA256SUMS"), `${checksums.join("\n")}\n`);
execFileSync("tar", ["-czf", join(output, `${name}.tar.gz`), "-C", output, name], { stdio: "inherit" });
const archive = join(output, `${name}.tar.gz`);
const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(`${archive}.sha256`, `${digest}  ${name}.tar.gz\n`);
console.log(`\nPackage: ${archive} (${(statSync(archive).size / 1024 / 1024).toFixed(1)} MiB)`);
console.log(`Install: bash ${join(payload, "install.sh")} --prefix <directory> --bin-dir <PATH directory>`);
