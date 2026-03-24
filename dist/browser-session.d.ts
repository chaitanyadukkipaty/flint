/**
 * browser-session.ts
 * Manages a single shared headed Playwright browser instance.
 * Both LLM (via MCP) and user (via CDP) operate on this session.
 */
import { Browser, BrowserContext, Page } from 'playwright';
export interface SessionState {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    sessionId: string;
    flowPath: string;
}
export declare function getOrCreateSession(flowName?: string): Promise<SessionState>;
export declare function getActiveSession(): SessionState | null;
export declare function closeSession(): Promise<void>;
//# sourceMappingURL=browser-session.d.ts.map