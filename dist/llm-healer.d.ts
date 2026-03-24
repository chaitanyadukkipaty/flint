import { Page } from 'playwright';
import { FlowStep } from './flow-recorder';
export interface HealResult {
    css: string;
    xpath: string;
    reasoning: string;
}
/**
 * Ask Claude Code CLI to suggest an alternative locator for a failed step.
 * Returns null if healing is not possible (claude not in PATH, DOM empty, etc.).
 */
export declare function healStep(page: Page, step: FlowStep, error: string): Promise<HealResult | null>;
//# sourceMappingURL=llm-healer.d.ts.map