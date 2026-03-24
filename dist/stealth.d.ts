/**
 * stealth.ts
 * Hides Playwright automation signals so websites treat the browser
 * as a regular user session rather than a scraping bot.
 */
import { BrowserContext } from 'playwright';
/** Extra CLI flags for chromium.launch({ args: stealthArgs() }) */
export declare function stealthArgs(): string[];
/**
 * Apply stealth init scripts to an existing BrowserContext.
 * Call immediately after browser.newContext().
 */
export declare function applyStealthToContext(context: BrowserContext): Promise<void>;
//# sourceMappingURL=stealth.d.ts.map