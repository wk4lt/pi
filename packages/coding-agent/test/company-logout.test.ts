import { expect, it, vi } from "vitest";
import { OAuthSelectorComponent } from "../src/modes/interactive/components/oauth-selector.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

it("removes the selected gateway credential through the logout selector", async () => {
	initTheme("dark");
	const logout = vi.fn(async () => {});
	let selector: OAuthSelectorComponent | undefined;
	const fake = {
		getLogoutProviderOptions: async () => [{ id: "company-gateway", name: "Gateway", authType: "api_key" }],
		session: { modelRuntime: { logout } },
		updateAvailableProviderCount: async () => {},
		showStatus: vi.fn(),
		showError: vi.fn(),
		ui: { requestRender() {} },
		showSelector: (factory: (done: () => void) => { component: OAuthSelectorComponent }) => {
			selector = factory(() => {}).component;
		},
	};
	const method = (InteractiveMode.prototype as unknown as { showOAuthSelector: (this: typeof fake) => Promise<void> })
		.showOAuthSelector;
	await method.call(fake);
	expect(selector).toBeInstanceOf(OAuthSelectorComponent);
	selector!.handleInput("\r");
	await vi.waitFor(() => expect(logout).toHaveBeenCalledWith("company-gateway", { signal: expect.any(AbortSignal) }));
	await vi.waitFor(() =>
		expect(fake.showStatus).toHaveBeenCalledWith(expect.stringContaining("Removed stored API key")),
	);
	expect(fake.showError).not.toHaveBeenCalled();
});
