import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	Container,
	Editor,
	getKeybindings,
	setKeybindings,
	stripTerminalSequences,
	TuiMainScreen,
} from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import type { AgentSession } from "../src/core/agent-session.ts";
import { saveCompanyGateway } from "../src/core/company-gateway.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import { main } from "../src/main.ts";
import { reportBug } from "../src/modes/interactive/bug-report.ts";
import { ExtensionEditorComponent } from "../src/modes/interactive/components/extension-editor.ts";
import { ExtensionSelectorComponent } from "../src/modes/interactive/components/extension-selector.ts";
import { shareSession } from "../src/modes/interactive/session-share.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";
import { handlePackageCommand } from "../src/package-manager-cli.ts";

const originalExitCode = process.exitCode;
afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	process.exitCode = originalExitCode;
});

describe("company CLI offline policy", () => {
	it("enables offline mode and disables version checks and install telemetry at CLI startup", async () => {
		vi.stubEnv("PI_OFFLINE", "0");
		vi.stubEnv("PI_SKIP_VERSION_CHECK", "");
		vi.stubEnv("PI_TELEMETRY", "1");
		vi.spyOn(console, "log").mockImplementation(() => {});
		await main(["auth", "help"]);
		expect(process.env.PI_OFFLINE).toBe("1");
		expect(process.env.PI_SKIP_VERSION_CHECK).toBe("1");
		expect(process.env.PI_TELEMETRY).toBe("0");
	});

	it("still sends model requests to the configured gateway in offline mode", async () => {
		vi.stubEnv("PI_OFFLINE", "1");
		const directory = mkdtempSync(join(tmpdir(), "pi-offline-gateway-"));
		vi.stubEnv("PI_CODING_AGENT_DIR", directory);
		try {
			const provider = await saveCompanyGateway("http://localhost:9123/v1", "test-model", "test-key");
			const runtime = await ModelRuntime.create({
				modelsPath: join(directory, "models.json"),
				authPath: join(directory, "auth.json"),
				allowModelNetwork: false,
			});
			const model = runtime.getModel(provider, "test-model");
			expect(model).toBeDefined();
			const requests: Request[] = [];
			const fetch: typeof globalThis.fetch = async (input, init) => {
				requests.push(new Request(input, init));
				const chunk = {
					id: "mock",
					object: "chat.completion.chunk",
					created: 0,
					model: "test-model",
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				};
				return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
					headers: { "content-type": "text/event-stream" },
				});
			};
			const result = await runtime.completeSimple(model!, { messages: [] }, { fetch });
			expect(result.stopReason).toBe("stop");
			expect(requests[0]?.url).toBe("http://localhost:9123/v1/chat/completions");
			expect(requests[0]?.headers.get("authorization")).toBe("Bearer test-key");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("blocks sharing before accessing the session or performing network operations", async () => {
		vi.stubEnv("PI_OFFLINE", "1");
		const showError = vi.fn();
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		await shareSession({ showError } as never);
		expect(showError).toHaveBeenCalledWith(expect.stringContaining("disabled"));
		expect(fetch).not.toHaveBeenCalled();
		expect(BUILTIN_SLASH_COMMANDS.some((command) => command.name === "share")).toBe(false);
		expect(BUILTIN_SLASH_COMMANDS.some((command) => command.name === "export")).toBe(true);
	});

	it("offers only local diagnostic export in offline mode", async () => {
		vi.stubEnv("PI_OFFLINE", "1");
		initTheme("dark");
		const previousKeybindings = getKeybindings();
		const keybindings = new KeybindingsManager();
		setKeybindings(keybindings);
		try {
			const ui = new TuiMainScreen(new VirtualTerminal());
			const container = new Container();
			const editor = new Editor(ui, getEditorTheme());
			const session = {
				model: undefined,
				settingsManager: { getExternalEditorCommand: () => "nano" },
			} as unknown as AgentSession;
			const report = reportBug({
				session,
				ui,
				editorContainer: container,
				editor,
				keybindings,
				showStatus: vi.fn(),
				showError: vi.fn(),
			});
			const description = container.children[0];
			if (!(description instanceof ExtensionEditorComponent)) throw new Error("Missing description input");
			description.handleInput("\r");
			await vi.waitFor(() => expect(container.children[0]).toBeInstanceOf(ExtensionSelectorComponent));
			const transcript = container.children[0] as ExtensionSelectorComponent;
			transcript.handleInput("\r");
			await vi.waitFor(() => expect(container.children[0]).toBeInstanceOf(ExtensionSelectorComponent));
			const delivery = container.children[0] as ExtensionSelectorComponent;
			const lines = delivery.render(120).map(stripTerminalSequences).join("\n");
			expect(lines).toContain("Export as Zip");
			expect(lines).not.toContain("Upload Report");
			delivery.handleInput("j");
			delivery.handleInput("\r");
			await report;
		} finally {
			setKeybindings(previousKeybindings);
		}
	});

	it("blocks online package installs while allowing local extension paths", async () => {
		vi.stubEnv("PI_OFFLINE", "1");
		const directory = mkdtempSync(join(tmpdir(), "pi-offline-policy-"));
		try {
			const manager = new DefaultPackageManager({
				cwd: directory,
				agentDir: directory,
				settingsManager: SettingsManager.inMemory(),
			});
			await expect(manager.install("npm:example")).rejects.toThrow("Network package installation is disabled");
			await expect(manager.install("git:https://example.invalid/team/repo.git")).rejects.toThrow(
				"Network package installation is disabled",
			);
			await expect(manager.install(directory)).resolves.toBeUndefined();
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it.each([
		["update", "--models"],
		["update", "--self"],
		["update", "--extensions"],
	])("blocks explicit %s %s before any fetch", async (...args) => {
		vi.stubEnv("PI_OFFLINE", "1");
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await handlePackageCommand(args)).toBe(true);
		expect(process.exitCode).toBe(1);
		expect(fetch).not.toHaveBeenCalled();
	});
});
