/**
 * stealth.ts
 * Hides Playwright automation signals so websites treat the browser
 * as a regular user session rather than a scraping bot.
 *
 * Techniques applied:
 *  - Remove navigator.webdriver flag
 *  - Spoof realistic navigator / plugins / languages
 *  - Hide chrome.runtime absence (sites check for real Chrome object)
 *  - Randomise canvas fingerprint slightly
 *  - Pass common headless-detection checks (permissions, screen size, etc.)
 */
import { BrowserContext, LaunchOptions } from 'playwright';
/** Extra CLI flags for chromium.launch({ args: stealthArgs() }) */
export declare function stealthArgs(): string[];
/** Default launch options that look like a real Chrome install */
export declare const stealthLaunchOptions: Partial<LaunchOptions>;
/**
 * Apply stealth init scripts to an existing BrowserContext.
 * Call this immediately after browser.newContext() / browser.newPage().
 */
export declare function applyStealthToContext(context: BrowserContext): Promise<void>;
//# sourceMappingURL=stealth.d.ts.map