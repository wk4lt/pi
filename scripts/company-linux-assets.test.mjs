// Verify download integrity, cache reuse, corruption recovery, and failed-download cleanup.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cacheCompanyAsset } from "./company-linux-assets.mjs";

test("verifies downloads, reuses good cache and replaces corrupt cache", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pi-asset-cache-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const content = "pinned-asset\n";
	let requests = 0;
	const server = createServer((_request, response) => {
		requests++;
		response.end(content);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	const asset = {
		filename: "asset.tar.gz",
		url: `http://127.0.0.1:${server.address().port}/asset`,
		sha256: createHash("sha256").update(content).digest("hex"),
	};
	const path = await cacheCompanyAsset(asset, directory);
	assert.equal(readFileSync(path, "utf8"), content);
	assert.equal(requests, 1);
	assert.equal(await cacheCompanyAsset(asset, directory), path);
	assert.equal(requests, 1);
	writeFileSync(path, "corrupt");
	await cacheCompanyAsset(asset, directory);
	assert.equal(readFileSync(path, "utf8"), content);
	assert.equal(requests, 2);
});

test("rejects an unverified download without publishing it or leaving partial files", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pi-asset-mismatch-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const server = createServer((_request, response) => response.end("wrong-content"));
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	await assert.rejects(
		cacheCompanyAsset(
			{
				filename: "asset.tar.gz",
				url: `http://127.0.0.1:${server.address().port}/asset`,
				sha256: "0".repeat(64),
			},
			directory,
		),
		/SHA-256 mismatch/,
	);
	assert.deepEqual(readdirSync(directory), []);
});
