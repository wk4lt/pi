// Cache build downloads by their reviewed SHA-256 and replace them only after verification.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Return a verified cached asset, downloading it when missing or corrupt. */
export async function cacheCompanyAsset(asset, directory) {
	mkdirSync(directory, { recursive: true });
	const path = join(directory, asset.filename);
	if (existsSync(path) && sha256(path) === asset.sha256) return path;
	const temporary = `${path}.${randomUUID()}.part`;
	try {
		console.log(`Downloading ${asset.filename}`);
		await execFileAsync("curl", [
			"--fail",
			"--silent",
			"--show-error",
			"--location",
			"--retry",
			"2",
			"--connect-timeout",
			"10",
			"--max-time",
			"180",
			"--output",
			temporary,
			asset.url,
		]);
		if (sha256(temporary) !== asset.sha256) throw new Error(`SHA-256 mismatch for ${asset.filename}`);
		renameSync(temporary, path);
		return path;
	} finally {
		rmSync(temporary, { force: true });
	}
}

function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}
