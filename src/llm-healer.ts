/**
 * llm-healer.ts
 * When a replay step fails, captures live DOM context and asks an LLM
 * to find an alternative CSS/XPath locator, then retries the step.
 *
 * Healing strategy (in order):
 *   1. Claude Code CLI (`claude --print`) — no API key needed
 *   2. Anthropic API  (`ANTHROPIC_API_KEY`) — works with VS Code Copilot or any env
 */
import { spawnSync } from 'child_process';
import { Page } from 'playwright';
import { FlowStep } from './flow-recorder';

const HEAL_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    css:       { type: 'string' },
    xpath:     { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['css', 'xpath', 'reasoning'],
});

async function extractPageElements(page: Page): Promise<string> {
  return page.evaluate(() => {
    const sel = 'a,button,input,select,textarea,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[onclick]';
    return Array.from(document.querySelectorAll(sel))
      .slice(0, 80)
      .map(el => {
        const e = el as HTMLElement;
        const tag = e.tagName.toLowerCase();
        const parts: string[] = [`<${tag}`];
        if (e.id)                                       parts.push(` id="${e.id}"`);
        const tid = e.getAttribute('data-testid') ?? e.getAttribute('data-cy') ?? '';
        if (tid)                                        parts.push(` data-testid="${tid}"`);
        const al = e.getAttribute('aria-label') ?? '';
        if (al)                                         parts.push(` aria-label="${al}"`);
        const nm = e.getAttribute('name') ?? '';
        if (nm)                                         parts.push(` name="${nm}"`);
        const ph = (e as HTMLInputElement).placeholder ?? '';
        if (ph)                                         parts.push(` placeholder="${ph}"`);
        const tp = e.getAttribute('type') ?? '';
        if (tp)                                         parts.push(` type="${tp}"`);
        const cls = e.className?.trim().split(/\s+/).slice(0, 2).join(' ');
        if (cls)                                        parts.push(` class="${cls}"`);
        const txt = e.innerText?.trim().slice(0, 60);
        parts.push(txt ? `>${txt}` : '>');
        return parts.join('');
      })
      .join('\n');
  });
}

export interface HealResult {
  css: string;
  xpath: string;
  reasoning: string;
}

function buildPrompt(step: FlowStep, error: string, pageUrl: string, elements: string): string {
  return (
    `A browser automation replay step failed. Find a working CSS selector for the target element.\n\n` +
    `Failed step:\n` +
    `  action: ${step.action}\n` +
    `  element name: ${step.element!.name}\n` +
    `  original CSS: ${step.element!.css}\n` +
    `  original XPath: ${step.element!.xpath}\n` +
    `  error: ${error}\n` +
    `  page URL: ${pageUrl}\n\n` +
    `Current page interactive elements:\n${elements}\n\n` +
    `Find the element that best matches "${step.element!.name}" and return its CSS selector and XPath.`
  );
}

/** Strategy 1: Claude Code CLI */
function healWithClaudeCli(prompt: string): HealResult | null {
  const result = spawnSync(
    'claude',
    ['--print', '--output-format', 'json', '--json-schema', HEAL_SCHEMA, '--bare', '--no-session-persistence', prompt],
    { encoding: 'utf8', timeout: 60_000 },
  );

  if (result.error || result.status !== 0) return null;

  try {
    const outer = JSON.parse(result.stdout.trim());
    const inner = typeof outer.result === 'string' ? JSON.parse(outer.result) : outer;
    if (typeof inner.css === 'string' && typeof inner.xpath === 'string') return inner as HealResult;
  } catch {}
  return null;
}

/** Strategy 2: Anthropic API (requires ANTHROPIC_API_KEY) */
async function healWithAnthropicApi(prompt: string): Promise<HealResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.default();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `${prompt}\n\nRespond with ONLY a JSON object: {"css":"...","xpath":"...","reasoning":"..."}`,
      }],
    });
    const text = (response.content[0] as { type: string; text: string }).text.trim();
    // Strip markdown code fences if present
    const json = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(json);
    if (typeof parsed.css === 'string' && typeof parsed.xpath === 'string') return parsed as HealResult;
  } catch {}
  return null;
}

/**
 * Ask an LLM for an alternative locator when a step fails.
 * Tries Claude Code CLI first, then Anthropic API, then gives up.
 */
export async function healStep(page: Page, step: FlowStep, error: string): Promise<HealResult | null> {
  if (!step.element) return null;

  let elements: string;
  try {
    elements = await extractPageElements(page);
  } catch { return null; }

  if (!elements.trim()) {
    console.warn('  ⚠ No interactive elements found on page — skipping LLM healing');
    return null;
  }

  const prompt = buildPrompt(step, error, page.url(), elements);

  // 1. Try Claude Code CLI (works without API key — uses existing auth)
  const cliResult = healWithClaudeCli(prompt);
  if (cliResult) return cliResult;

  // 2. Try Anthropic API (works in VS Code Copilot or any environment with key)
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('  ℹ claude CLI unavailable — using Anthropic API');
    const apiResult = await healWithAnthropicApi(prompt);
    if (apiResult) return apiResult;
  } else {
    console.warn('  ⚠ claude CLI not found and ANTHROPIC_API_KEY not set — skipping LLM healing');
    console.warn('    Set ANTHROPIC_API_KEY to enable healing without Claude Code CLI');
  }

  return null;
}
