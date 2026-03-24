"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healStep = healStep;
/**
 * llm-healer.ts
 * When a replay step fails, captures live DOM context and asks an LLM
 * to find an alternative CSS/XPath locator, then retries the step.
 *
 * Healing strategy (in order):
 *   1. Claude Code CLI (`claude --print`) — no API key needed
 *   2. Anthropic API  (`ANTHROPIC_API_KEY`) — works with VS Code Copilot or any env
 */
const child_process_1 = require("child_process");
const config_1 = require("./config");
const HEAL_SCHEMA = JSON.stringify({
    type: 'object',
    properties: {
        css: { type: 'string' },
        xpath: { type: 'string' },
        reasoning: { type: 'string' },
    },
    required: ['css', 'xpath', 'reasoning'],
});
async function extractPageElements(page) {
    return page.evaluate(() => {
        const sel = 'a,button,input,select,textarea,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[onclick]';
        return Array.from(document.querySelectorAll(sel))
            .slice(0, 80)
            .map(el => {
            const e = el;
            const tag = e.tagName.toLowerCase();
            const parts = [`<${tag}`];
            if (e.id)
                parts.push(` id="${e.id}"`);
            const tid = e.getAttribute('data-testid') ?? e.getAttribute('data-cy') ?? '';
            if (tid)
                parts.push(` data-testid="${tid}"`);
            const al = e.getAttribute('aria-label') ?? '';
            if (al)
                parts.push(` aria-label="${al}"`);
            const nm = e.getAttribute('name') ?? '';
            if (nm)
                parts.push(` name="${nm}"`);
            const ph = e.placeholder ?? '';
            if (ph)
                parts.push(` placeholder="${ph}"`);
            const tp = e.getAttribute('type') ?? '';
            if (tp)
                parts.push(` type="${tp}"`);
            const cls = e.className?.trim().split(/\s+/).slice(0, 2).join(' ');
            if (cls)
                parts.push(` class="${cls}"`);
            const txt = e.innerText?.trim().slice(0, 60);
            parts.push(txt ? `>${txt}` : '>');
            return parts.join('');
        })
            .join('\n');
    });
}
function buildPrompt(step, error, pageUrl, elements) {
    return (`A browser automation replay step failed. Find a working CSS selector for the target element.\n\n` +
        `Failed step:\n` +
        `  action: ${step.action}\n` +
        `  element name: ${step.element.name}\n` +
        `  original CSS: ${step.element.css}\n` +
        `  original XPath: ${step.element.xpath}\n` +
        `  error: ${error}\n` +
        `  page URL: ${pageUrl}\n\n` +
        `Current page interactive elements:\n${elements}\n\n` +
        `Find the element that best matches "${step.element.name}" and return its CSS selector and XPath.`);
}
/** Strategy 1: Claude Code CLI (`claude --print`) */
function healWithClaudeCli(prompt) {
    const result = (0, child_process_1.spawnSync)('claude', ['--print', '--output-format', 'json', '--json-schema', HEAL_SCHEMA, '--bare', '--no-session-persistence', prompt], { encoding: 'utf8', timeout: 60_000 });
    if (result.error || result.status !== 0)
        return null;
    try {
        const outer = JSON.parse(result.stdout.trim());
        const inner = typeof outer.result === 'string' ? JSON.parse(outer.result) : outer;
        if (typeof inner.css === 'string' && typeof inner.xpath === 'string')
            return inner;
    }
    catch { }
    return null;
}
/** Strategy 2: GitHub Models API via `gh auth token` (works for any GitHub/Copilot user) */
async function healWithGitHubModels(prompt) {
    // Get GitHub token from gh CLI
    const tokenResult = (0, child_process_1.spawnSync)('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 5_000 });
    if (tokenResult.error || tokenResult.status !== 0)
        return null;
    const token = tokenResult.stdout.trim();
    if (!token)
        return null;
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
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    const text = parsed.choices?.[0]?.message?.content?.trim() ?? '';
                    const json = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
                    const result = JSON.parse(json);
                    if (typeof result.css === 'string' && typeof result.xpath === 'string') {
                        resolve(result);
                    }
                    else {
                        resolve(null);
                    }
                }
                catch {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(30_000, () => { req.destroy(); resolve(null); });
        req.write(body);
        req.end();
    });
}
/** Strategy 3: Anthropic API (requires ANTHROPIC_API_KEY) */
async function healWithAnthropicApi(prompt) {
    if (!process.env.ANTHROPIC_API_KEY)
        return null;
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
        const text = response.content[0].text.trim();
        const json = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        const parsed = JSON.parse(json);
        if (typeof parsed.css === 'string' && typeof parsed.xpath === 'string')
            return parsed;
    }
    catch { }
    return null;
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
async function healStep(page, step, error) {
    if (!step.element)
        return null;
    let elements;
    try {
        elements = await extractPageElements(page);
    }
    catch {
        return null;
    }
    if (!elements.trim()) {
        console.warn('  ⚠ No interactive elements found on page — skipping LLM healing');
        return null;
    }
    const prompt = buildPrompt(step, error, page.url(), elements);
    const config = (0, config_1.loadConfig)();
    const assistant = config?.assistant ?? 'both';
    // Define strategy lists per preference
    const strategies = assistant === 'copilot'
        ? [
            { name: 'GitHub Models (gh auth token)', fn: () => healWithGitHubModels(prompt) },
            { name: 'Anthropic API (ANTHROPIC_API_KEY)', fn: () => healWithAnthropicApi(prompt) },
            { name: 'Claude Code CLI', fn: async () => healWithClaudeCli(prompt) },
        ]
        : [
            { name: 'Claude Code CLI', fn: async () => healWithClaudeCli(prompt) },
            { name: 'GitHub Models (gh auth token)', fn: () => healWithGitHubModels(prompt) },
            { name: 'Anthropic API (ANTHROPIC_API_KEY)', fn: () => healWithAnthropicApi(prompt) },
        ];
    for (const { name, fn } of strategies) {
        const result = await fn();
        if (result) {
            console.log(`  ✓ Healed via ${name}`);
            return result;
        }
    }
    console.warn('  ⚠ All healing strategies failed. To enable healing:');
    console.warn('    - Claude Code: install and authenticate the claude CLI');
    console.warn('    - VS Code Copilot: run `gh auth login`');
    console.warn('    - Any env: set ANTHROPIC_API_KEY');
    return null;
}
