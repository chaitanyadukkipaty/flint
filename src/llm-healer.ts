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
import { loadConfig } from './config';

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
    // Broad selector matching browser-use's interactive element detection
    const sel = [
      'a[href]', 'button', 'input', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
      '[role="tab"]', '[role="menuitem"]', '[role="combobox"]', '[role="option"]',
      '[role="switch"]', '[tabindex]:not([tabindex="-1"])', '[onclick]',
    ].join(',');

    const viewportH = window.innerHeight;
    const lines: string[] = [];
    let idx = 0;

    document.querySelectorAll<HTMLElement>(sel).forEach(el => {
      // Multi-layer visibility check (browser-use approach)
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      if (parseFloat(style.opacity) <= 0) return;

      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      // Include elements up to 2 viewports below current scroll (browser-use viewport_threshold)
      if (r.bottom < 0 || r.top > viewportH * 2) return;

      const tag = el.tagName.toLowerCase();
      const parts: string[] = [`[i_${idx++}] <${tag}`];

      if (el.id)                                         parts.push(` id="${el.id}"`);
      const tid = el.getAttribute('data-testid') ?? el.getAttribute('data-cy') ?? el.getAttribute('data-test') ?? '';
      if (tid)                                           parts.push(` data-testid="${tid}"`);
      const role = el.getAttribute('role') ?? '';
      if (role)                                          parts.push(` role="${role}"`);
      const al = el.getAttribute('aria-label') ?? '';
      if (al)                                            parts.push(` aria-label="${al}"`);
      const nm = el.getAttribute('name') ?? '';
      if (nm)                                            parts.push(` name="${nm}"`);
      const ph = (el as HTMLInputElement).placeholder ?? '';
      if (ph)                                            parts.push(` placeholder="${ph}"`);
      const tp = el.getAttribute('type') ?? '';
      if (tp)                                            parts.push(` type="${tp}"`);
      const expanded = el.getAttribute('aria-expanded') ?? '';
      if (expanded)                                      parts.push(` aria-expanded="${expanded}"`);
      const checked = el.getAttribute('aria-checked') ?? '';
      if (checked)                                       parts.push(` aria-checked="${checked}"`);

      const txt = el.innerText?.trim().slice(0, 80);
      parts.push(txt ? `>${txt}` : '>');
      lines.push(parts.join(''));
    });

    return lines.slice(0, 80).join('\n');
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

/** Strategy 1: Claude Code CLI (`claude --print`) */
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

/** Strategy 2: GitHub Models API via `gh auth token` (works for any GitHub/Copilot user) */
async function healWithGitHubModels(prompt: string): Promise<HealResult | null> {
  // Get GitHub token from gh CLI
  const tokenResult = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 5_000 });
  if (tokenResult.error || tokenResult.status !== 0) return null;
  const token = tokenResult.stdout.trim();
  if (!token) return null;

  const body = JSON.stringify({
    model: 'gpt-4o-mini',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `${prompt}\n\nRespond with ONLY a JSON object: {"css":"...","xpath":"...","reasoning":"..."}`,
    }],
  });

  return new Promise(resolve => {
    const https = require('https');
    const req = https.request({
      hostname: 'models.inference.ai.azure.com',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text: string = parsed.choices?.[0]?.message?.content?.trim() ?? '';
          const start = text.indexOf('{'), end = text.lastIndexOf('}');
          const result = JSON.parse(start !== -1 && end > start ? text.slice(start, end + 1) : text);
          if (typeof result.css === 'string' && typeof result.xpath === 'string') {
            resolve(result as HealResult);
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(30_000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
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
  const config = loadConfig();
  const assistant = config?.assistant ?? 'both';

  const strategies: Array<{ name: string; fn: () => Promise<HealResult | null> }> =
    assistant === 'copilot'
      ? [{ name: 'GitHub Models', fn: () => healWithGitHubModels(prompt) }]
      : assistant === 'claude'
      ? [{ name: 'Claude Code CLI', fn: async () => healWithClaudeCli(prompt) }]
      : [
          { name: 'Claude Code CLI', fn: async () => healWithClaudeCli(prompt) },
          { name: 'GitHub Models',   fn: () => healWithGitHubModels(prompt) },
        ];

  for (const { name, fn } of strategies) {
    const result = await fn();
    if (result) {
      console.log(`  ✓ Healed via ${name}`);
      return result;
    }
  }

  const hint = assistant === 'copilot' ? 'run `gh auth login`'
    : assistant === 'claude' ? 'install and authenticate the claude CLI'
    : 'install claude CLI or run `gh auth login`';
  console.warn(`  ⚠ LLM healing failed. To enable: ${hint}`);
  return null;
}
