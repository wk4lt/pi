import { createServer } from "node:http";
import { connect, type Socket } from "node:net";

/** Limit npm's HTTP CONNECT requests to the explicitly configured registry. */
export async function withRegistryProxy<T>(
	registry: URL,
	upstream: URL | undefined,
	run: (proxy: string) => Promise<T>,
): Promise<T> {
	if (upstream && (upstream.protocol !== "http:" || upstream.pathname !== "/" || upstream.search || upstream.hash)) {
		throw new Error("Only an HTTP npm proxy is supported for internal package installation.");
	}
	const sockets = new Set<Socket>();
	const server = createServer((_request, response) => {
		response.writeHead(403).end();
	});
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});
	server.on("connect", (request, client, head) => {
		let target: URL;
		try {
			target = new URL(`https://${request.url}`);
		} catch {
			client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
			return;
		}
		const expectedPort = registry.port || "443";
		if (
			target.hostname !== registry.hostname ||
			(target.port || "443") !== expectedPort ||
			target.username ||
			target.password
		) {
			client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
			return;
		}
		const remote = connect(
			Number(upstream?.port || (upstream ? 80 : expectedPort)),
			upstream?.hostname || registry.hostname,
		);
		remote.on("error", () => client.destroy());
		client.on("error", () => remote.destroy());
		client.on("close", () => remote.destroy());
		if (!upstream) {
			remote.once("connect", () => {
				client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
				if (head.length) remote.write(head);
				client.pipe(remote).pipe(client);
			});
			return;
		}
		remote.once("connect", () => {
			const auth = upstream.username
				? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(upstream.username)}:${decodeURIComponent(upstream.password)}`).toString("base64")}\r\n`
				: "";
			remote.write(
				`CONNECT ${registry.hostname}:${expectedPort} HTTP/1.1\r\nHost: ${registry.hostname}:${expectedPort}\r\n${auth}\r\n`,
			);
		});
		let headers = Buffer.alloc(0);
		const onData = (chunk: Buffer) => {
			headers = Buffer.concat([headers, chunk]);
			if (headers.length > 32768) {
				remote.destroy();
				client.destroy();
				return;
			}
			const end = headers.indexOf("\r\n\r\n");
			if (end < 0) return;
			remote.removeListener("data", onData);
			if (!/^HTTP\/1\.[01] 200(?: |\r)/.test(headers.subarray(0, end).toString("latin1"))) {
				remote.destroy();
				client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
				return;
			}
			client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
			if (headers.length > end + 4) client.write(headers.subarray(end + 4));
			if (head.length) remote.write(head);
			client.pipe(remote).pipe(client);
		};
		remote.on("data", onData);
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Unable to start registry proxy.");
	try {
		return await run(`http://127.0.0.1:${address.port}`);
	} finally {
		for (const socket of sockets) socket.destroy();
		server.close();
	}
}
