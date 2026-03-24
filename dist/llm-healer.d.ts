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
 * Strategy order:
 *   1. Claude Code CLI  — `claude --print`   (Claude Code users, no key needed)
 *   2. GitHub Models    — `gh auth token`     (GitHub / VS Code Copilot users, no key needed)
 *   3. Anthropic API    — ANTHROPIC_API_KEY   (explicit API key fallback)
 */
export declare function healStep(page: Page, step: FlowStep, error: string): Promise<HealResult | null>;
//# sourceMappingURL=llm-healer.d.ts.map