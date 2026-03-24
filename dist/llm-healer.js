"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healStep = healStep;
/**
 * llm-healer.ts
 * When a replay step fails, captures live DOM context and uses the
 * `claude` CLI (Claude Code) to find an alternative CSS/XPath locator.
 * No API key required — piggybacks on the existing Claude Code session.
 */
const child_process_1 = require("child_process");
const HEAL_SCHEMA = JSON.stringify({
    type: 'object',
    properties: {
        css: { type: 'string' },
        xpath: { type: 'string' },
        reasoning: { type: 'string' },
    },
    required: ['css', 'xpath', 'reasoning'],
});
/** Extract interactive elements visible on the current page */
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
/**
 * Ask Claude Code CLI to suggest an alternative locator for a failed step.
 * Returns null if healing is not possible (claude not in PATH, DOM empty, etc.).
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
    const prompt = `A browser automation replay step failed. Find a working CSS selector for the target element.\n\n` +
        `Failed step:\n` +
        `  action: ${step.action}\n` +
        `  element name: ${step.element.name}\n` +
        `  original CSS: ${step.element.css}\n` +
        `  original XPath: ${step.element.xpath}\n` +
        `  error: ${error}\n` +
        `  page URL: ${page.url()}\n\n` +
        `Current page interactive elements:\n${elements}\n\n` +
        `Find the element that best matches "${step.element.name}" and return its CSS selector and XPath.`;
    const result = (0, child_process_1.spawnSync)('claude', [
        '--print',
        '--output-format', 'json',
        '--json-schema', HEAL_SCHEMA,
        '--bare',
        '--no-session-persistence',
        prompt,
    ], { encoding: 'utf8', timeout: 60_000 });
    if (result.error) {
        console.warn(`  ⚠ claude CLI not available: ${result.error.message}`);
        return null;
    }
    if (result.status !== 0) {
        console.warn(`  ⚠ claude CLI exited ${result.status}: ${result.stderr?.trim()}`);
        return null;
    }
    try {
        const outer = JSON.parse(result.stdout.trim());
        // --output-format json wraps response in { result: "..." }
        const inner = typeof outer.result === 'string' ? JSON.parse(outer.result) : outer;
        if (typeof inner.css === 'string' && typeof inner.xpath === 'string') {
            return { css: inner.css, xpath: inner.xpath, reasoning: inner.reasoning ?? '' };
        }
        return null;
    }
    catch (e) {
        console.warn(`  ⚠ Could not parse LLM response: ${e.message}`);
        return null;
    }
}
