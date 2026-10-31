// Verify offline installation, command relocation, working-directory preservation, and refusal paths.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scripts = dirname(fileURLToPath(import.meta.url));

function fixture(t) {
	const directory = mkdtempSync(join(tmpdir(), "pi-linux-install-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const source = join(directory, "extracted package");
	const prefix = join(directory, "installed product");
	const bin = join(directory, "commands");
	const cwd = join(directory, "business project");
	const cli = "app/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js";
	mkdirSync(dirname(join(source, cli)), { recursive: true });
	mkdirSync(join(source, "runtime/bin"), { recursive: true });
	mkdirSync(join(source, "bin"));
	mkdirSync(cwd);
	symlinkSync(process.execPath, join(source, "runtime/bin/node"));
	cpSync(join(scripts, "company-linux/install.sh"), join(source, "install.sh"));
	cpSync(join(scripts, "company-linux/uninstall.sh"), join(source, "uninstall.sh"));
	cpSync(join(scripts, "company-linux/pi"), join(source, "bin/pi"));
	chmodSync(join(source, "bin/pi"), 0o755);
	writeFileSync(
		join(source, cli),
		'if(process.argv[2]==="--version") console.log("1.4.0"); else console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),path:process.env.PATH,offline:process.env.PI_OFFLINE}));\n',
	);
	const files = ["install.sh", "uninstall.sh", "bin/pi", cli];
	writeFileSync(
		join(source, "SHA256SUMS"),
		`${files
			.map(
				(file) =>
					`${createHash("sha256")
						.update(readFileSync(join(source, file)))
						.digest("hex")}  ./${file}`,
			)
			.join("\n")}\n`,
	);
	const args = [join(source, "install.sh"), "--prefix", prefix, "--bin-dir", bin];
	return { directory, source, prefix, bin, cwd, args };
}

test(
	"installs without npm and runs from another directory through PATH",
	{ skip: process.platform !== "linux" },
	(t) => {
		const f = fixture(t);
		execFileSync("bash", f.args, { cwd: f.cwd, env: { ...process.env, npm_config_offline: "true" } });
		renameSync(f.source, join(f.directory, "removed source"));
		const args = ["a file with spaces", "$(touch should-not-exist)", "--name", "example"];
		const output = execFileSync("pi", args, {
			cwd: f.cwd,
			env: { ...process.env, PATH: `${f.bin}:/usr/bin:/bin` },
			encoding: "utf8",
		});
		assert.deepEqual(JSON.parse(output), { cwd: f.cwd, args, path: `${f.bin}:/usr/bin:/bin`, offline: "1" });
		assert.equal(existsSync(join(f.cwd, "should-not-exist")), false);
		assert.equal(execFileSync(join(f.bin, "pi"), ["--version"], { cwd: f.cwd, encoding: "utf8" }).trim(), "1.4.0");
	},
);

test("refuses an existing install directory without changing it", { skip: process.platform !== "linux" }, (t) => {
	const f = fixture(t);
	mkdirSync(f.prefix);
	writeFileSync(join(f.prefix, "sentinel"), "keep");
	const result = spawnSync("bash", f.args, { encoding: "utf8" });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /already exists/);
	assert.equal(readFileSync(join(f.prefix, "sentinel"), "utf8"), "keep");
});

test("refuses to replace a command, including a broken symlink", { skip: process.platform !== "linux" }, (t) => {
	const f = fixture(t);
	mkdirSync(f.bin);
	symlinkSync("/missing-existing-pi", join(f.bin, "pi"));
	const result = spawnSync("bash", f.args, { encoding: "utf8" });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Command already exists/);
	assert.equal(existsSync(f.prefix), false);
});

test("rejects payload corruption before installing", { skip: process.platform !== "linux" }, (t) => {
	const f = fixture(t);
	writeFileSync(join(f.source, "bin/pi"), "corrupted");
	const result = spawnSync("bash", f.args, { encoding: "utf8" });
	assert.notEqual(result.status, 0);
	assert.equal(existsSync(f.prefix), false);
});

test(
	"rejects relative paths and a command directory inside the install",
	{ skip: process.platform !== "linux" },
	(t) => {
		const f = fixture(t);
		for (const args of [
			["--prefix", "relative", "--bin-dir", f.bin],
			["--prefix", f.prefix, "--bin-dir", join(f.prefix, "bin")],
		]) {
			const result = spawnSync("bash", [join(f.source, "install.sh"), ...args], { encoding: "utf8" });
			assert.notEqual(result.status, 0);
			assert.equal(existsSync(f.prefix), false);
		}
	},
);

test("rejects a public npm registry before installing dependencies", { skip: process.platform !== "linux" }, (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pi-registry-check-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const fakeNpm = join(directory, "npm.mjs");
	const marker = join(directory, "unexpected-install");
	writeFileSync(fakeNpm, `import { writeFileSync } from "node:fs";\nif (process.argv.slice(2).join(" ") === "config get registry") console.log("https://registry.npmjs.org/"); else writeFileSync(${JSON.stringify(marker)}, "called");\n`);
	const result = spawnSync(process.execPath, [join(scripts, "build-company-linux.mjs")], {
		encoding: "utf8",
		env: { ...process.env, npm_execpath: fakeNpm },
	});
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Configure npm registry/);
	assert.equal(existsSync(marker), false);
});

test("uses the configured npm mirror without an extra environment variable", { skip: process.platform !== "linux" }, (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pi-registry-check-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const fakeNpm = join(directory, "npm.mjs");
	const marker = join(directory, "npm-arguments");
	writeFileSync(fakeNpm, `import { writeFileSync } from "node:fs";\nif (process.argv.slice(2).join(" ") === "config get registry") console.log("https://registry.example.invalid/"); else { writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.argv.slice(2))); process.exit(7); }\n`);
	const env = { ...process.env, npm_execpath: fakeNpm };
	delete env.PI_COMPANY_NPM_REGISTRY;
	const result = spawnSync(process.execPath, [join(scripts, "build-company-linux.mjs")], { encoding: "utf8", env });
	assert.notEqual(result.status, 0);
	const args = JSON.parse(readFileSync(marker, "utf8"));
	assert.equal(args[0], "ci");
	assert.ok(args.includes("--registry=https://registry.example.invalid/"));
});

test("uses the default paths and uninstalls while keeping user configuration", { skip: process.platform !== "linux" }, (t) => {
	const f = fixture(t);
	const home = join(f.directory, "home");
	const prefix = join(home, "apps/company-pi");
	const command = join(home, ".local/bin/pi");
	const config = join(home, ".pi/agent");
	mkdirSync(config, { recursive: true });
	writeFileSync(join(config, "settings.json"), "keep");
	execFileSync("bash", [join(f.source, "install.sh")], { env: { ...process.env, HOME: home } });
	assert.equal(execFileSync(command, ["--version"], { encoding: "utf8" }).trim(), "1.4.0");
	execFileSync("bash", [join(prefix, "uninstall.sh")], { env: { ...process.env, HOME: home } });
	assert.equal(existsSync(prefix), false);
	assert.equal(existsSync(command), false);
	assert.equal(readFileSync(join(config, "settings.json"), "utf8"), "keep");
});

test("uninstalls a custom prefix without deleting a replaced command", { skip: process.platform !== "linux" }, (t) => {
	const f = fixture(t);
	execFileSync("bash", f.args);
	const command = join(f.bin, "pi");
	rmSync(command);
	writeFileSync(command, "other program");
	execFileSync("bash", [join(f.prefix, "uninstall.sh")]);
	assert.equal(existsSync(f.prefix), false);
	assert.equal(readFileSync(command, "utf8"), "other program");
});

test("refuses to uninstall an extracted but uninstalled package", { skip: process.platform !== "linux" }, (t) => {
	const f = fixture(t);
	const result = spawnSync("bash", [join(f.source, "uninstall.sh")], { encoding: "utf8" });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Not a recognized installed/);
	assert.equal(existsSync(join(f.source, "install.sh")), true);
});
