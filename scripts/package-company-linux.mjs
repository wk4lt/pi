#!/usr/bin/env node
// Package the built company CLI with the local Node runtime and production dependencies.
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
		node: { type: "string" },
		npm: { type: "string" },
		out: { type: "string", default: join(repoRoot, ".artifacts/company-linux") },
		help: { type: "boolean" },
	},
});
if (values.help) {
	console.log(
		"Usage: node scripts/package-company-linux.mjs --node <Node binary> --npm <npm-cli.js> [--out <new directory>]\nRun npm run build:offline first. Builds a Linux package for the current architecture.",
	);
	process.exit(0);
}
if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch)) {
	throw new Error("Build on Linux x64 or arm64 for the same target architecture.");
}
if (!values.node || !values.npm) throw new Error("--node and --npm are required");
const node = resolve(values.node);
const npm = resolve(values.npm);
const runtimeInfo = JSON.parse(
	execFileSync(node, ["-p", "JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch})"], { encoding: "utf8" }),
);
const [major, minor] = runtimeInfo.version.split(".").map(Number);
if (runtimeInfo.version !== process.versions.node || runtimeInfo.platform !== "linux" || runtimeInfo.arch !== process.arch || major < 22 || (major === 22 && minor < 19)) {
	throw new Error(`Expected Linux ${process.arch} Node >=22.19.0 matching the build Node, got ${JSON.stringify(runtimeInfo)}`);
}
if (!existsSync(join(repoRoot, "packages/coding-agent/dist/bundle/cli.js"))) {
	throw new Error("Build output is missing. Run npm run build:offline first.");
}
const output = resolve(values.out);
if (existsSync(output)) throw new Error(`Output already exists; choose a new --out directory: ${output}`);
mkdirSync(output, { recursive: true });

const env = { ...process.env };
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
		npm,
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

mkdirSync(join(payload, "runtime/bin"), { recursive: true });
cpSync(node, join(payload, "runtime/bin/node"));
const licenseCandidates = [process.env.PI_NODE_LICENSE_FILE, join(dirname(dirname(node)), "LICENSE"), join(dirname(dirname(node)), "share/doc/nodejs/copyright")].filter(Boolean);
const nodeLicense = licenseCandidates.find((path) => existsSync(path));
if (!nodeLicense) throw new Error("Node license not found. Set PI_NODE_LICENSE_FILE to the license for the build Node.");
cpSync(nodeLicense, join(payload, "runtime/NODE-LICENSE.txt"));
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
			node: runtimeInfo.version,
			tools: "system",
			source: artifacts.source,
			modelData: { package: "@earendil-works/pi-ai", version: JSON.parse(readFileSync(join(repoRoot, "packages/ai/package.json"), "utf8")).version, manifestSha256: createHash("sha256").update(readFileSync(join(repoRoot, "packages/ai/src/providers/data/.manifest.json"))).digest("hex") },
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
