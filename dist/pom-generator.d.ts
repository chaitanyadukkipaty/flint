/**
 * pom-generator.ts
 * Analyzes the current page and returns CSS + XPath locators.
 * Output is plain text for inline display — no files written.
 *
 * Resilience scoring:
 *   data-testid/data-cy/data-qa  → 95
 *   aria-label                   → 90
 *   stable id                    → 85
 *   label[for] association       → 80
 *   name attribute               → 75
 *   placeholder                  → 70
 *   type + semantic tag          → 60
 *   class-based CSS              → 40
 *   nth-child / position-based   → 20 (flagged ⚠)
 */
import { Page } from 'playwright';
export interface LocatorEntry {
    name: string;
    css: string;
    xpath: string;
    resilience: number;
    fragile: boolean;
}
export declare function generateLocators(page: Page): Promise<LocatorEntry[]>;
export declare function formatLocators(entries: LocatorEntry[], url: string, title: string): string;
//# sourceMappingURL=pom-generator.d.ts.map