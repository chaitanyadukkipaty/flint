import { Page } from 'playwright';
import { LocatorEntry } from './pom-generator';
export interface LLMLocatorResult {
    entries: LocatorEntry[];
    reasoning: string;
}
export declare function suggestLocatorsWithLLM(page: Page, screenshotDir: string, sectionSelector?: string): Promise<LLMLocatorResult>;
//# sourceMappingURL=llm-locator.d.ts.map