import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Container, type TUI } from "@earendil-works/pi-tui";
import { expect, it, vi } from "vitest";
import { ExtensionSelectorComponent } from "../src/modes/interactive/components/extension-selector.ts";
import { LoginDialogComponent } from "../src/modes/interactive/components/login-dialog.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

it("hides the API key before and after submission", async () => {
	initTheme("dark");
	const tui = { requestRender() {} } as unknown as TUI;
	const dialog = new LoginDialogComponent(tui, "company", () => {}, undefined, "Gateway", true);
	dialog.focused = true;
	const result = dialog.showPrompt("API Key");
	dialog.handleInput("test-secret-key");
	expect(dialog.render(100).join("\n")).not.toContain("test-secret-key");
	dialog.handleInput("\r");
	expect(await result).toBe("test-secret-key");
	expect(dialog.render(100).join("\n")).not.toContain("test-secret-key");
});

it("runs the gateway login prompts and selects the saved model", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-login-flow-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		initTheme("dark");
		const container = new Container();
		const model = { id: "internal-model" };
		const setModel = vi.fn(async () => {});
		const fake = {
			ui: { setFocus() {}, requestRender() {} },
			editorContainer: container,
			editor: new Container(),
			session: { modelRuntime: { refresh: async () => ({ errors: new Map() }), getModel: () => model }, setModel },
			updateAvailableProviderCount: async () => {},
			footer: { invalidate() {} },
			updateEditorBorderColor() {},
			showStatus() {},
			showError: vi.fn(),
		};
		const method = (
			InteractiveMode.prototype as unknown as { handleLoginCommand: (this: typeof fake) => Promise<void> }
		).handleLoginCommand;
		const pending = method.call(fake);
		const first = container.children[0] as LoginDialogComponent;
		first.handleInput("http://gateway.invalid/v1");
		first.handleInput("\r");
		await Promise.resolve();
		const secret = container.children[0] as LoginDialogComponent;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [{ id: "first-model" }, { id: "internal-model" }] })),
		);
		secret.handleInput("test-secret");
		expect(secret.render(100).join("\n")).not.toContain("test-secret");
		secret.handleInput("\r");
		await vi.waitFor(() => expect(container.children[0]).toBeInstanceOf(ExtensionSelectorComponent));
		const selector = container.children[0] as ExtensionSelectorComponent;
		selector.handleInput("j");
		selector.handleInput("\r");
		await pending;
		expect(fake.showError).not.toHaveBeenCalled();
		expect(setModel).toHaveBeenCalledWith(model, { persist: true });
		const config = readFileSync(join(dir, "models.json"), "utf8");
		expect(config).not.toContain("test-secret");
		expect(JSON.parse(config).providers["company-gateway"].models.map((model: { id: string }) => model.id)).toEqual([
			"first-model",
			"internal-model",
		]);
	} finally {
		vi.unstubAllGlobals();
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
});

it("allows manual model entry when discovery is unavailable", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-login-fallback-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		initTheme("dark");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("", { status: 401 })),
		);
		const container = new Container();
		const model = { id: "manual-model" };
		const setModel = vi.fn(async () => {});
		const fake = {
			ui: { setFocus() {}, requestRender() {} },
			editorContainer: container,
			editor: new Container(),
			session: { modelRuntime: { refresh: async () => ({ errors: new Map() }), getModel: () => model }, setModel },
			updateAvailableProviderCount: async () => {},
			footer: { invalidate() {} },
			updateEditorBorderColor() {},
			showStatus() {},
			showError: vi.fn(),
		};
		const method = (
			InteractiveMode.prototype as unknown as { handleLoginCommand: (this: typeof fake) => Promise<void> }
		).handleLoginCommand;
		const pending = method.call(fake);
		const urlDialog = container.children[0] as LoginDialogComponent;
		urlDialog.handleInput("https://gateway.invalid/v1");
		urlDialog.handleInput("\r");
		await Promise.resolve();
		const secretDialog = container.children[0] as LoginDialogComponent;
		secretDialog.handleInput("test-secret");
		secretDialog.handleInput("\r");
		await vi.waitFor(() => expect(container.children[0]).not.toBe(secretDialog));
		const fallback = container.children[0] as LoginDialogComponent;
		expect(fallback.render(120).join("\n")).not.toContain("test-secret");
		fallback.handleInput("manual-model");
		fallback.handleInput("\r");
		await pending;
		expect(fake.showError).not.toHaveBeenCalled();
		expect(setModel).toHaveBeenCalledWith(model, { persist: true });
		expect(JSON.parse(readFileSync(join(dir, "models.json"), "utf8")).providers["company-gateway"].models).toEqual([
			{ id: "manual-model" },
		]);
	} finally {
		vi.unstubAllGlobals();
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
});
