import { Page } from 'playwright';
import { FlowStep } from './flow-recorder';
export interface HealResult {
    css: string;
    xpath: string;
    reasoning: string;
}
/**
 * Ask an LLM for an alternative locator when a step fails.
 * Tries Claude Code CLI first, then Anthropic API, then gives up.
 */
export declare function healStep(page: Page, step: FlowStep, error: string): Promise<HealResult | null>;
//# sourceMappingURL=llm-healer.d.ts.map