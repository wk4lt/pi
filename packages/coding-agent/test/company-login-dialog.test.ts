import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Container, type TUI } from "@earendil-works/pi-tui";
import { expect, it, vi } from "vitest";
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
		first.handleInput("internal-model");
		first.handleInput("\r");
		await Promise.resolve();
		const secret = container.children[0] as LoginDialogComponent;
		secret.handleInput("test-secret");
		expect(secret.render(100).join("\n")).not.toContain("test-secret");
		secret.handleInput("\r");
		await pending;
		expect(fake.showError).not.toHaveBeenCalled();
		expect(setModel).toHaveBeenCalledWith(model, { persist: true });
		expect(readFileSync(join(dir, "models.json"), "utf8")).not.toContain("test-secret");
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
});
