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
 * Strategy order is determined by .flint.json (set via `flint init`):
 *   claude  → Claude CLI first,   then GitHub Models, then Anthropic API
 *   copilot → GitHub Models first, then Anthropic API, then Claude CLI
 *   both    → Claude CLI first,   then GitHub Models, then Anthropic API
 *   (none)  → same as both
 */
export declare function healStep(page: Page, step: FlowStep, error: string): Promise<HealResult | null>;
//# sourceMappingURL=llm-healer.d.ts.map