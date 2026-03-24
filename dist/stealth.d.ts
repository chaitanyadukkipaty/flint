/**
 * stealth.ts
 * Uses playwright-extra + puppeteer-extra-plugin-stealth for comprehensive
 * bot-detection evasion, plus additional patches for aggressive sites
 * like BrowserStack that probe hardware/WebGL/CDP signals.
 */
import { BrowserContext } from 'playwright';
export declare const stealthChromium: any;
/** Extra CLI flags for chromium.launch() */
export declare function stealthArgs(extraPorts?: string[]): string[];
/** Context options that look like a real Chrome session */
export declare const stealthContextOptions: {
    userAgent: string;
    viewport: {
        width: number;
        height: number;
    };
    locale: string;
};
/**
 * Extra patches on top of the stealth plugin for sites that probe
 * hardware/WebGL/CDP-specific signals (e.g. BrowserStack, Cloudflare).
 */
export declare function applyStealthToContext(context: BrowserContext): Promise<void>;
//# sourceMappingURL=stealth.d.ts.map