"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.suggestLocatorsWithLLM = suggestLocatorsWithLLM;
/**
 * llm-locator.ts
 * Asks an LLM to suggest test locators directly from a screenshot + condensed DOM.
 * Used when --llm flag is passed to `flint session`.
 *
 * The LLM receives:
 *   - A screenshot (full page or clipped to selected section)
 *   - Condensed DOM context (visible interactive elements in scope)
 * and returns locators it considers useful, with CSS, XPath and resilience scores.
 *
 * Strategy order mirrors llm-healer.ts (respects .flint.json):
 *   claude  → Claude CLI, then Anthropic API (vision), then GitHub Models
 *   copilot → GitHub Models, then Anthropic API (vision), then Claude CLI
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const config_1 = require("./config");
// ---------------------------------------------------------------------------
// 1. Context capture — screenshot + condensed DOM scoped to section
// ---------------------------------------------------------------------------
async function captureContext(page, screenshotDir, sectionSelector) {
    const screenshotPath = path.join(screenshotDir, `llm-ctx-${Date.now()}.png`);
    if (sectionSelector) {
        const clip = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el)
                return null;
            const r = el.getBoundingClientRect();
            return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: r.width, height: r.height };
        }, sectionSelector);
        await page.screenshot({ path: screenshotPath, ...(clip && clip.width > 0 ? { clip } : {}) });
    }
    else {
        await page.screenshot({ path: screenshotPath });
    }
    const screenshotB64 = fs.readFileSync(screenshotPath).toString('base64');
    // Condensed DOM: visible interactive elements, scoped via visual overlap to capture portals
    const domContext = await page.evaluate((sel) => {
        const root = sel ? (document.querySelector(sel) || document.body) : document.body;
        const isFullPage = root === document.body;
        const sectionRect = root.getBoundingClientRect();
        const viewH = window.innerHeight;
        const SELECTORS = [
            'a[href]', 'button', 'input', 'select', 'textarea',
            '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
            '[role="menuitemradio"]', '[role="tab"]', '[role="checkbox"]', '[role="combobox"]',
            '[role="option"]', '[role="switch"]', '[tabindex]:not([tabindex="-1"])',
        ].join(',');
        const lines = [];
        let idx = 0;
        document.querySelectorAll(SELECTORS).forEach(el => {
            const s = window.getComputedStyle(el);
            if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) <= 0)
                return;
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0 || r.bottom < 0 || r.top > viewH * 2)
                return;
            if (!isFullPage) {
                const inRoot = root.contains(el);
                if (!inRoot) {
                    // Only include portaled elements (position:absolute/fixed ancestor) near the section
                    const hBuffer = Math.max(sectionRect.height * 2, 80);
                    const hOverlap = r.left < sectionRect.right && r.right > sectionRect.left;
                    const vNear = r.top < sectionRect.bottom + hBuffer && r.bottom > sectionRect.top - hBuffer;
                    let isPortal = false;
                    let cur = el.parentElement;
                    while (cur && cur !== document.body) {
                        if (root.contains(cur))
                            break;
                        const cs = window.getComputedStyle(cur);
                        if ((cs.position === 'fixed' || cs.position === 'absolute') && parseInt(cs.zIndex || '0') > 0) {
                            isPortal = true;
                            break;
                        }
                        cur = cur.parentElement;
                    }
                    if (!isPortal || !hOverlap || !vNear)
                        return;
                }
            }
            const tag = el.tagName.toLowerCase();
            const parts = [`[${idx++}] <${tag}`];
            const role = el.getAttribute('role');
            if (role)
                parts.push(` role="${role}"`);
            const al = el.getAttribute('aria-label');
            if (al)
                parts.push(` aria-label="${al}"`);
            const id = el.id;
            if (id && !/^\d|react-|ember/.test(id))
                parts.push(` id="${id}"`);
            const tid = el.getAttribute('data-testid') || el.getAttribute('data-cy');
            if (tid)
                parts.push(` data-testid="${tid}"`);
            const nm = el.getAttribute('name');
            if (nm)
                parts.push(` name="${nm}"`);
            const ph = el.placeholder;
            if (ph)
                parts.push(` placeholder="${ph}"`);
            const href = el.getAttribute('href');
            if (href && href !== '#')
                parts.push(` href="${href.slice(0, 80)}"`);
            const txt = el.innerText?.trim().slice(0, 60);
            if (txt)
                parts.push(`>${txt}`);
            lines.push(parts.join(''));
        });
        return lines.slice(0, 100).join('\n');
    }, sectionSelector ?? null);
    return { screenshotPath, screenshotB64, domContext };
}
// ---------------------------------------------------------------------------
// 2. Prompt — ask LLM to generate locators, not filter
// ---------------------------------------------------------------------------
const LOCATOR_SCHEMA = JSON.stringify({
    type: 'object',
    properties: {
        locators: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    css: { type: 'string' },
                    xpath: { type: 'string' },
                    resilience: { type: 'number' },
                    fragile: { type: 'boolean' },
                },
                required: ['name', 'css', 'xpath', 'resilience'],
            },
        },
        reasoning: { type: 'string' },
    },
    required: ['locators', 'reasoning'],
});
function buildPrompt(domContext, url, sectionSelector) {
    const scope = sectionSelector ? `the selected section (${sectionSelector})` : 'the full page';
    return (`You are a test automation expert. Analyze the screenshot and DOM context of ${scope} ` +
        `and suggest the best CSS and XPath locators for test automation.\n\n` +
        `URL: ${url}\n\n` +
        `Visible interactive elements in scope:\n${domContext}\n\n` +
        `For each important interactive element you can see, generate:\n` +
        `- name: snake_case identifier (e.g. sign_in_button, search_input)\n` +
        `- css: the most resilient CSS selector\n` +
        `- xpath: the most resilient XPath\n` +
        `- resilience: 0-100 score (100 = data-testid, 90 = aria-label, 85 = stable id, ` +
        `75 = name attr, 60 = text-based, 20 = structural/fragile)\n` +
        `- fragile: true if the selector may break on minor DOM changes\n\n` +
        `Prioritise semantic selectors (aria-label, data-testid, role+text) over structural ones. ` +
        `Include all user-facing interactive elements visible in the screenshot.\n\n` +
        `Return ONLY a JSON object:\n` +
        `{"locators":[{"name":"...","css":"...","xpath":"...","resilience":90,"fragile":false},...],` +
        `"reasoning":"brief explanation"}`);
}
function parseLocators(text) {
    try {
        const json = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed.locators))
            return { locators: parsed.locators, reasoning: parsed.reasoning ?? '' };
    }
    catch { }
    return null;
}
function normalise(raw) {
    const entries = raw.locators
        .filter(l => l.name && l.css && l.xpath)
        .map(l => ({
        name: l.name,
        css: l.css,
        xpath: l.xpath,
        resilience: typeof l.resilience === 'number' ? l.resilience : 60,
        fragile: l.fragile ?? false,
    }));
    return { entries, reasoning: raw.reasoning };
}
/** Claude Code CLI — passes prompt via stdin to handle long prompts safely */
function suggestWithClaudeCli(prompt) {
    const result = (0, child_process_1.spawnSync)('claude', ['--print', '--no-session-persistence'], { input: prompt, encoding: 'utf8', timeout: 60_000 });
    if (result.error) {
        console.warn(`  [Claude CLI] spawn error: ${result.error.message}`);
        return null;
    }
    if (result.status !== 0) {
        console.warn(`  [Claude CLI] exited ${result.status}: ${(result.stderr || '').slice(0, 200)}`);
        return null;
    }
    const raw = parseLocators(result.stdout.trim());
    if (!raw) {
        console.warn(`  [Claude CLI] could not parse JSON from response`);
        return null;
    }
    return normalise(raw);
}
/** Anthropic API — sends screenshot as vision input */
async function suggestWithAnthropicApi(prompt, screenshotB64) {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.warn('  [Anthropic API] skipped — ANTHROPIC_API_KEY not set');
        return null;
    }
    try {
        const Anthropic = require('@anthropic-ai/sdk');
        const client = new Anthropic.default();
        const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            messages: [{
                    role: 'user',
                    content: [
                        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotB64 } },
                        { type: 'text', text: prompt },
                    ],
                }],
        });
        const text = response.content.find((b) => b.type === 'text')?.text?.trim() ?? '';
        const raw = parseLocators(text);
        return raw ? normalise(raw) : null;
    }
    catch (e) {
        console.warn(`  [Anthropic API] error: ${e.message}`);
        return null;
    }
}
/** GitHub Models API — text-only */
async function suggestWithGitHubModels(prompt) {
    const tokenResult = (0, child_process_1.spawnSync)('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 5_000 });
    if (tokenResult.error || tokenResult.status !== 0) {
        console.warn('  [GitHub Models] skipped — gh auth token not available');
        return null;
    }
    const token = tokenResult.stdout.trim();
    if (!token) {
        console.warn('  [GitHub Models] skipped — empty token');
        return null;
    }
    const body = JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
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
            res.on('data', (c) => data += c);
            res.on('end', () => {
                try {
                    const text = JSON.parse(data).choices?.[0]?.message?.content?.trim() ?? '';
                    const raw = parseLocators(text);
                    resolve(raw ? normalise(raw) : null);
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
// ---------------------------------------------------------------------------
// 4. Public API
// ---------------------------------------------------------------------------
async function suggestLocatorsWithLLM(page, screenshotDir, sectionSelector) {
    console.log('  🤖 Asking LLM to suggest locators...');
    const { screenshotPath: _sp, screenshotB64, domContext } = await captureContext(page, screenshotDir, sectionSelector);
    const prompt = buildPrompt(domContext, page.url(), sectionSelector);
    const config = (0, config_1.loadConfig)();
    const assistant = config?.assistant ?? 'both';
    const strategies = assistant === 'copilot'
        ? [
            { name: 'GitHub Models', fn: () => suggestWithGitHubModels(prompt) },
            { name: 'Anthropic API', fn: () => suggestWithAnthropicApi(prompt, screenshotB64) },
            { name: 'Claude CLI', fn: async () => suggestWithClaudeCli(prompt) },
        ]
        : [
            { name: 'Claude CLI', fn: async () => suggestWithClaudeCli(prompt) },
            { name: 'Anthropic API', fn: () => suggestWithAnthropicApi(prompt, screenshotB64) },
            { name: 'GitHub Models', fn: () => suggestWithGitHubModels(prompt) },
        ];
    for (const { name, fn } of strategies) {
        const result = await fn();
        if (result && result.entries.length > 0) {
            console.log(`  ✓ ${result.entries.length} locators suggested via ${name}`);
            return result;
        }
    }
    console.warn('  ⚠ LLM suggestion failed — falling back to code-based locators.');
    return { entries: [], reasoning: 'LLM unavailable.' };
}
