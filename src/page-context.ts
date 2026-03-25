/**
 * page-context.ts
 * Converts a live Playwright page into structured LLM-understandable context.
 * Inspired by browser-use: accessibility tree + screenshot + cleaned DOM.
 */
import { Page } from 'playwright';

export interface PageElement {
  index: number;
  role: string;
  name: string;
  tag: string;
  type?: string;
  testId?: string;
  locator: string;
}

export interface PageContext {
  url: string;
  title: string;
  screenshotPath: string;
  elements: PageElement[];
  contentSummary: string;
  scrollInfo: string;
  formatted: string;
}

interface RawElement {
  index: number;
  tag: string;
  role: string;
  name: string;
  type: string;
  testId: string;
  ariaExpanded: string;
  ariaChecked: string;
  disabled: boolean;
}

export async function buildPageContext(
  page: Page,
  screenshotPath: string
): Promise<PageContext> {
  // 1. Screenshot
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const url = page.url();
  const title = await page.title();

  // 2. Extract interactive elements with proper visibility filtering
  const rawElements: RawElement[] = await page.evaluate(() => {
    // Broad selector to catch all interactive elements including JS-driven ones
    const sel = [
      'a[href]', 'button', 'input', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
      '[role="tab"]', '[role="menuitem"]', '[role="combobox"]', '[role="option"]',
      '[role="switch"]', '[role="slider"]', '[role="spinbutton"]',
      '[tabindex]:not([tabindex="-1"])', '[onclick]',
    ].join(',');

    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const results: RawElement[] = [];
    let idx = 0;

    document.querySelectorAll<HTMLElement>(sel).forEach(el => {
      // --- Visibility checks (inspired by browser-use multi-layer approach) ---
      const style = window.getComputedStyle(el);
      if (style.display === 'none') return;
      if (style.visibility === 'hidden') return;
      if (parseFloat(style.opacity) <= 0) return;

      const r = el.getBoundingClientRect();
      // Skip zero-size elements (not rendered)
      if (r.width <= 0 || r.height <= 0) return;
      // Skip elements entirely outside the current viewport + 1 viewport below
      if (r.bottom < 0 || r.top > viewportH * 2) return;
      if (r.right < 0 || r.left > viewportW) return;

      const tag = el.tagName.toLowerCase();

      // Derive role: explicit role attr → semantic tag mapping → tag name
      const explicitRole = el.getAttribute('role') ?? '';
      const tagRoleMap: Record<string, string> = {
        button: 'button', a: 'link', input: 'textbox', select: 'combobox',
        textarea: 'textbox',
      };
      const inputType = (el as HTMLInputElement).type?.toLowerCase() ?? '';
      let role = explicitRole || tagRoleMap[tag] || tag;
      if (tag === 'input' && inputType === 'checkbox') role = 'checkbox';
      if (tag === 'input' && inputType === 'radio') role = 'radio';
      if (tag === 'input' && inputType === 'button') role = 'button';
      if (tag === 'input' && inputType === 'submit') role = 'button';

      // Best human-readable name: aria-label > placeholder > text > name > value
      const rawText = el.innerText?.trim().slice(0, 80) ?? '';
      const name =
        el.getAttribute('aria-label')?.trim() ||
        (el as HTMLInputElement).placeholder?.trim() ||
        rawText ||
        el.getAttribute('name')?.trim() ||
        (el as HTMLInputElement).value?.trim().slice(0, 40) ||
        el.getAttribute('title')?.trim() ||
        '';

      if (!name) return; // Skip unnamed elements — LLM can't reason about them

      const testId =
        el.getAttribute('data-testid') ??
        el.getAttribute('data-cy') ??
        el.getAttribute('data-test') ?? '';

      const ariaExpanded = el.getAttribute('aria-expanded') ?? '';
      const ariaChecked = el.getAttribute('aria-checked') ??
        String((el as HTMLInputElement).checked ?? '');
      const disabled = (el as HTMLInputElement).disabled ?? false;

      results.push({ index: idx++, tag, role, name, type: inputType, testId, ariaExpanded, ariaChecked, disabled });
    });

    return results.slice(0, 60);
  });

  const elements: PageElement[] = rawElements.map(n => ({
    index: n.index,
    tag: n.tag,
    role: n.role,
    name: n.name,
    type: n.type || undefined,
    testId: n.testId || undefined,
    locator: buildLocator(n),
  }));

  // 3. Visible text content (headings + key paragraphs)
  const contentSummary = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('h1,h2,h3,h4,p,label'));
    return els
      .map(el => {
        const style = window.getComputedStyle(el as HTMLElement);
        if (style.display === 'none' || style.visibility === 'hidden') return '';
        return (el as HTMLElement).innerText?.trim().slice(0, 120) ?? '';
      })
      .filter(t => t.length > 1)
      .slice(0, 20)
      .join('\n');
  });

  // 4. Scroll information (browser-use approach: show hidden content awareness)
  const scrollInfo = await page.evaluate(() => {
    const body = document.body;
    const el = document.documentElement;
    const scrollY = window.scrollY;
    const totalH = Math.max(body.scrollHeight, el.scrollHeight);
    const viewH = window.innerHeight;
    if (totalH <= viewH) return '';
    const pagesBelow = Math.round((totalH - viewH - scrollY) / viewH * 10) / 10;
    return pagesBelow > 0.1 ? `↓ ${pagesBelow} viewport(s) of content below` : '';
  });

  // 5. Format as structured text for LLM consumption
  const elementLines = elements
    .map(el => {
      const stateFlags = [
        el.type ? `type=${el.type}` : '',
        el.testId ? `testid=${el.testId}` : '',
      ].filter(Boolean).join(' ');
      const stateStr = stateFlags ? ` (${stateFlags})` : '';
      return `  [i_${el.index}] <${el.tag}> [${el.role}] "${el.name}"${stateStr}`;
    })
    .join('\n');

  const formatted = [
    `## Page: ${title}`,
    `URL: ${url}`,
    scrollInfo ? `Scroll: ${scrollInfo}` : '',
    `### Interactive Elements`,
    elementLines || '  (none found)',
    `### Visible Content`,
    contentSummary || '(empty)',
  ].filter(Boolean).join('\n');

  return { url, title, screenshotPath, elements, contentSummary, scrollInfo, formatted };
}

function buildLocator(node: RawElement): string {
  const { role, name, testId, tag, type } = node;
  if (testId) return `locator('[data-testid="${testId}"]')`;
  if (role === 'button') return `getByRole('button', { name: '${esc(name)}' })`;
  if (role === 'link') return `getByRole('link', { name: '${esc(name)}' })`;
  if (role === 'checkbox') return `getByLabel('${esc(name)}')`;
  if (role === 'radio') return `getByLabel('${esc(name)}')`;
  if (role === 'combobox') return `getByLabel('${esc(name)}')`;
  if (tag === 'input' || role === 'textbox' || role === 'searchbox') return `getByLabel('${esc(name)}')`;
  return `getByRole('${role}', { name: '${esc(name)}' })`;
}

function esc(s: string): string {
  return s.replace(/'/g, "\\'").slice(0, 60);
}
