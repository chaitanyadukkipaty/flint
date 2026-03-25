import { Page } from 'playwright';
import { FlowStep } from './flow-recorder';
export interface HealResult {
    css: string;
    xpath: string;
    reasoning: string;
}
/**
 * Ask an LLM for an alternative locator when a step fails.
 *
 * Strategy is determined by .flint.json (set via `flint init`):
 *   claude  → Claude CLI only
 *   copilot → GitHub Models only
 *   both    → Claude CLI, then GitHub Models
 *   (none)  → same as both
 */
export declare function healStep(page: Page, step: FlowStep, error: string): Promise<HealResult | null>;
//# sourceMappingURL=llm-healer.d.ts.map