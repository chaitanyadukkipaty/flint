"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPageContext = buildPageContext;
async function buildPageContext(page, screenshotPath) {
    // 1. Screenshot
    await page.screenshot({ path: screenshotPath, fullPage: false });
    const url = page.url();
    const title = await page.title();
    // 2. Extract interactive elements from DOM
    const rawElements = await page.evaluate(() => {
        const sel = 'input, button, a[href], select, textarea, [role]';
        const results = [];
        document.querySelectorAll(sel).forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0)
                return;
            const role = el.getAttribute('role') ?? el.tagName.toLowerCase();
            const name = el.getAttribute('aria-label') ??
                el.getAttribute('placeholder') ??
                el.value?.slice(0, 40) ??
                el.innerText?.trim().slice(0, 60) ??
                el.getAttribute('name') ??
                '';
            if (name)
                results.push({ role, name });
        });
        return results.slice(0, 50);
    });
    const elements = rawElements.map(n => ({
        role: n.role,
        name: n.name,
        locator: buildLocator(n),
    }));
    // 3. Visible text content (headings + paragraphs) via DOM eval
    const contentSummary = await page.evaluate(() => {
        const sel = 'h1, h2, h3, p, label, [aria-label]';
        const els = Array.from(document.querySelectorAll(sel));
        return els
            .map(el => el.innerText?.trim())
            .filter(t => t && t.length > 1 && t.length < 200)
            .slice(0, 20)
            .join('\n');
    });
    // 4. Format as structured markdown
    const elementLines = elements
        .slice(0, 40)
        .map(el => `  [${el.role.padEnd(10)}] "${el.name}" → ${el.locator}`)
        .join('\n');
    const formatted = [
        `## Page: ${title} | ${url}`,
        `### Interactive Elements`,
        elementLines || '  (none found)',
        `### Visible Content`,
        contentSummary || '(empty)',
    ].join('\n');
    return { url, title, screenshotPath, elements, contentSummary, formatted };
}
function buildLocator(node) {
    const { role, name } = node;
    if (role === 'button')
        return `getByRole('button', { name: '${esc(name)}' })`;
    if (role === 'link')
        return `getByRole('link', { name: '${esc(name)}' })`;
    if (role === 'textbox' || role === 'searchbox')
        return `getByLabel('${esc(name)}')`;
    if (role === 'checkbox')
        return `getByLabel('${esc(name)}')`;
    if (role === 'combobox')
        return `getByLabel('${esc(name)}')`;
    return `getByRole('${role}', { name: '${esc(name)}' })`;
}
function esc(s) {
    return s.replace(/'/g, "\\'").slice(0, 60);
}
