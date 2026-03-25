/**
 * page-context.ts
 * Converts a live Playwright page into structured LLM-understandable context.
 * Inspired by browser-use: accessibility tree + screenshot + cleaned DOM.
 */
import { Page } from 'playwright';
export interface PageElement {
    index: number;
    role: string;
    name: string;
    tag: string;
    type?: string;
    testId?: string;
    locator: string;
}
export interface PageContext {
    url: string;
    title: string;
    screenshotPath: string;
    elements: PageElement[];
    contentSummary: string;
    scrollInfo: string;
    formatted: string;
}
export declare function buildPageContext(page: Page, screenshotPath: string): Promise<PageContext>;
//# sourceMappingURL=page-context.d.ts.map