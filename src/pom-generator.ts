/**
 * pom-generator.ts
 * Analyzes the current page and returns CSS + XPath locators.
 * Output is plain text for inline display — no files written.
 *
 * Resilience scoring:
 *   data-testid/data-cy/data-qa  → 95
 *   aria-label                   → 90
 *   stable id                    → 85
 *   label[for] association       → 80
 *   name attribute               → 75
 *   placeholder                  → 70
 *   type + semantic tag          → 60
 *   class-based CSS              → 40
 *   nth-child / position-based   → 20 (flagged ⚠)
 */
import { Page } from 'playwright';

export interface LocatorEntry {
  name: string;
  css: string;
  xpath: string;
  resilience: number;
  fragile: boolean;
}

/**
 * Injects an interactive overlay that lets the user click on a section of the page.
 * Returns a unique CSS selector for the clicked element.
 */
export async function pickSection(page: Page): Promise<string | null> {
  console.log('\n  Click on a section to scope locator generation. Press Escape to use full page.\n');

  return page.evaluate(() => new Promise<string | null>(resolve => {
    const overlay = document.createElement('div');
    overlay.id = '__flint_section_picker__';
    overlay.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
      'z-index:2147483647', 'cursor:crosshair', 'pointer-events:all',
    ].join(';');

    const highlight = document.createElement('div');
    highlight.style.cssText = [
      'position:fixed', 'pointer-events:none', 'z-index:2147483646',
      'outline:3px solid #f97316', 'background:rgba(249,115,22,0.08)',
      'transition:all 0.08s', 'border-radius:3px',
    ].join(';');
    document.body.appendChild(highlight);

    const label = document.createElement('div');
    label.style.cssText = [
      'position:fixed', 'bottom:16px', 'left:50%', 'transform:translateX(-50%)',
      'background:#1e293b', 'color:#f8fafc', 'padding:8px 16px',
      'border-radius:6px', 'font:13px/1.4 monospace', 'z-index:2147483647',
      'pointer-events:none', 'white-space:nowrap',
    ].join(';');
    label.textContent = 'Hover over a section and click to scope • Esc = full page';
    document.body.appendChild(label);

    function buildSelector(el: Element): string {
      const e = el as HTMLElement;
      if (e.id && !/^\d|react-|ember/.test(e.id)) return `#${CSS.escape(e.id)}`;
      const testId = e.getAttribute('data-testid') ?? e.getAttribute('data-cy') ?? '';
      if (testId) return `[data-testid="${testId}"]`;
      const ariaLabel = e.getAttribute('aria-label') ?? '';
      if (ariaLabel) return `${e.tagName.toLowerCase()}[aria-label="${ariaLabel}"]`;
      // Build structural path (max 3 levels)
      const parts: string[] = [];
      let cur: Element | null = el;
      for (let depth = 0; depth < 3 && cur && cur !== document.body; depth++) {
        const tag = cur.tagName.toLowerCase();
        const siblings = cur.parentElement
          ? Array.from(cur.parentElement.children).filter(c => c.tagName === cur!.tagName)
          : [];
        parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(cur) + 1})` : tag);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }

    function getBlockAncestor(target: Element): Element {
      // Walk up to find a meaningful block container (not body/html)
      let el: Element | null = target;
      while (el && el !== document.body) {
        const tag = el.tagName.toLowerCase();
        const style = window.getComputedStyle(el);
        const display = style.display;
        const isBlock = display === 'block' || display === 'flex' || display === 'grid' || display === 'table';
        const hasBounds = el.getBoundingClientRect().width > 60 && el.getBoundingClientRect().height > 30;
        if (isBlock && hasBounds && tag !== 'html') return el;
        el = el.parentElement;
      }
      return document.body;
    }

    overlay.addEventListener('mousemove', (e: MouseEvent) => {
      overlay.style.pointerEvents = 'none';
      const target = document.elementFromPoint(e.clientX, e.clientY);
      overlay.style.pointerEvents = 'all';
      if (!target) return;
      const section = getBlockAncestor(target);
      const r = section.getBoundingClientRect();
      highlight.style.top = `${r.top}px`;
      highlight.style.left = `${r.left}px`;
      highlight.style.width = `${r.width}px`;
      highlight.style.height = `${r.height}px`;
      label.textContent = `<${section.tagName.toLowerCase()}${section.id ? '#'+section.id : ''}> • click to select • Esc = full page`;
    });

    overlay.addEventListener('click', (e: MouseEvent) => {
      overlay.style.pointerEvents = 'none';
      const target = document.elementFromPoint(e.clientX, e.clientY);
      overlay.style.pointerEvents = 'all';
      cleanup();
      if (!target) { resolve(null); return; }
      const section = getBlockAncestor(target);
      resolve(section === document.body ? null : buildSelector(section));
    });

    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') { cleanup(); resolve(null); }
    }, { once: true });

    function cleanup() {
      overlay.remove();
      highlight.remove();
      label.remove();
    }

    document.body.appendChild(overlay);
  }));
}

export async function generateLocators(page: Page, sectionSelector?: string): Promise<LocatorEntry[]> {
  const raw: LocatorEntry[] = await page.evaluate((rootSel: string | undefined) => {
    const root: Element = rootSel ? (document.querySelector(rootSel) ?? document.body) : document.body;
    const INTERACTIVE_SELECTORS =
      'input, button, a[href], select, textarea, [role="button"], ' +
      '[role="link"], [role="textbox"], [role="checkbox"], [role="combobox"], ' +
      '[role="tab"], [role="menuitem"], [role="switch"]';

    function isVisible(el: Element): boolean {
      const r = (el as HTMLElement).getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.opacity !== '0';
    }

    function toSnakeCase(str: string): string {
      return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'element';
    }

    function isAutoGeneratedId(id: string): boolean {
      return /^(react-|ember|__|\d|uid|comp|el-)/.test(id) || /\d{4,}/.test(id);
    }

    function escAttr(v: string): string {
      return v.replace(/'/g, "\\'").replace(/"/g, '\\"');
    }

    /** Build a minimal unique CSS path for the element as fallback */
    function buildCssPath(el: HTMLElement): string {
      const parts: string[] = [];
      let cur: HTMLElement | null = el;
      while (cur && cur !== document.body) {
        const tag = cur.tagName.toLowerCase();
        const siblings = cur.parentElement
          ? Array.from(cur.parentElement.children).filter(c => c.tagName === cur!.tagName)
          : [];
        const part = siblings.length > 1
          ? `${tag}:nth-of-type(${siblings.indexOf(cur) + 1})`
          : tag;
        parts.unshift(part);
        cur = cur.parentElement as HTMLElement | null;
        if (parts.length >= 4) break;
      }
      return parts.join(' > ');
    }

    /** Build XPath for the element as fallback */
    function buildXPath(el: HTMLElement): string {
      const parts: string[] = [];
      let cur: HTMLElement | null = el;
      while (cur && cur !== document.body) {
        const tag = cur.tagName.toLowerCase();
        const siblings = cur.parentElement
          ? Array.from(cur.parentElement.children).filter(c => c.tagName === cur!.tagName)
          : [];
        const part = siblings.length > 1
          ? `${tag}[${siblings.indexOf(cur) + 1}]`
          : tag;
        parts.unshift(part);
        cur = cur.parentElement as HTMLElement | null;
        if (parts.length >= 4) break;
      }
      return '//' + parts.join('/');
    }

    const seen = new Set<string>();
    const entries: any[] = [];

    root.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTORS).forEach(el => {
      if (!isVisible(el)) return;

      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type') ?? '';
      const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-cy') ?? el.getAttribute('data-qa') ?? '';
      const ariaLabel = el.getAttribute('aria-label') ?? '';
      const id = el.getAttribute('id') ?? '';
      const labelEl = id ? document.querySelector<HTMLElement>(`label[for="${id}"]`) : null;
      const labelText = labelEl?.innerText?.trim() ?? '';
      const innerText = el.innerText?.trim().slice(0, 60) ?? '';
      const placeholder = el.getAttribute('placeholder') ?? '';
      const name = el.getAttribute('name') ?? '';
      const cls = Array.from(el.classList).filter(c => !/\d{3,}/.test(c)).slice(0, 2).join('.');

      let css = '';
      let xpath = '';
      let resilience = 0;
      let fragile = false;
      let humanName = '';

      if (testId) {
        const attr = el.getAttribute('data-testid') ? 'data-testid' : el.getAttribute('data-cy') ? 'data-cy' : 'data-qa';
        css = `[${attr}="${escAttr(testId)}"]`;
        xpath = `//${tag}[@${attr}="${escAttr(testId)}"]`;
        resilience = 95;
        humanName = toSnakeCase(testId);
      } else if (ariaLabel) {
        css = `${tag}[aria-label="${escAttr(ariaLabel)}"]`;
        xpath = `//${tag}[@aria-label="${escAttr(ariaLabel)}"]`;
        resilience = 90;
        humanName = toSnakeCase(ariaLabel);
      } else if (id && !isAutoGeneratedId(id)) {
        css = `#${CSS.escape(id)}`;
        xpath = `//${tag}[@id="${escAttr(id)}"]`;
        resilience = 85;
        humanName = toSnakeCase(id);
      } else if (labelText) {
        css = id ? `#${CSS.escape(id)}` : `${tag}[name="${escAttr(name || id)}"]`;
        xpath = `//label[normalize-space()="${escAttr(labelText)}"]/following-sibling::${tag}[1]`;
        resilience = 80;
        humanName = toSnakeCase(labelText) + (tag === 'input' ? '_input' : '');
      } else if (name) {
        css = `${tag}[name="${escAttr(name)}"]`;
        xpath = `//${tag}[@name="${escAttr(name)}"]`;
        resilience = 75;
        humanName = toSnakeCase(name);
      } else if (placeholder) {
        css = `${tag}[placeholder="${escAttr(placeholder)}"]`;
        xpath = `//${tag}[@placeholder="${escAttr(placeholder)}"]`;
        resilience = 70;
        humanName = toSnakeCase(placeholder) + '_input';
      } else if (type && (tag === 'input' || tag === 'button')) {
        css = `${tag}[type="${type}"]`;
        xpath = `//${tag}[@type="${type}"]`;
        resilience = 60;
        humanName = toSnakeCase(type + '_' + tag);
      } else if (tag === 'button' && innerText) {
        const t = escAttr(innerText);
        css = `button`;
        xpath = `//button[normalize-space()="${t}"]`;
        resilience = 60;
        humanName = toSnakeCase(innerText) + '_button';
      } else if (tag === 'a' && innerText) {
        const t = escAttr(innerText);
        css = `a`;
        xpath = `//a[normalize-space()="${t}"]`;
        resilience = 60;
        humanName = toSnakeCase(innerText) + '_link';
      } else if (cls) {
        css = `${tag}.${cls.replace(/\./g, '.')}`;
        xpath = `//${tag}[contains(@class,"${cls.split('.')[0]}")]`;
        resilience = 40;
        fragile = true;
        humanName = toSnakeCase(cls.split('.')[0] || tag);
      } else {
        css = buildCssPath(el);
        xpath = buildXPath(el);
        resilience = 20;
        fragile = true;
        humanName = toSnakeCase(innerText || tag) + '_el';
      }

      // Deduplicate by CSS
      if (!css || seen.has(css)) return;
      seen.add(css);

      entries.push({ name: humanName, css, xpath, resilience, fragile });
    });

    return entries;
  }, sectionSelector);

  return raw.sort((a, b) => b.resilience - a.resilience);
}

export function formatLocators(entries: LocatorEntry[], url: string, title: string, sectionSelector?: string): string {
  const scope = sectionSelector ? ` (section: ${sectionSelector})` : '';
  const header = `Page: ${title} | ${url}${scope}\n`;
  const lines = entries.map(e => {
    const flag = e.fragile ? ' ⚠' : '';
    return (
      `${e.name.padEnd(28)} CSS: ${e.css.padEnd(50)} [${e.resilience}]${flag}\n` +
      `${''.padEnd(28)}      XPath: ${e.xpath}`
    );
  });
  return header + '\n' + lines.join('\n\n');
}

export async function runCli() {
  const { chromium } = require('playwright');
  const { stealthArgs, applyStealthToContext } = require('./stealth');
  const args = process.argv.slice(2);
  const sectionFlagIdx = args.findIndex(a => a === '--section' || a.startsWith('--section='));
  const wantsSection = sectionFlagIdx !== -1;
  const explicitSelector = wantsSection && args[sectionFlagIdx].includes('=')
    ? args[sectionFlagIdx].split('=').slice(1).join('=')
    : undefined;
  const urlArgs = args.filter(a => !a.startsWith('--'));
  const url = urlArgs[0] ?? 'https://example.com';

  const browser = await chromium.launch({ headless: false, channel: 'chrome', args: stealthArgs() })
    .catch(() => chromium.launch({ headless: false, args: stealthArgs() }));
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });
  await applyStealthToContext(context);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });

  let sectionSelector: string | undefined;
  if (explicitSelector) {
    sectionSelector = explicitSelector;
  } else if (wantsSection) {
    const picked = await pickSection(page);
    sectionSelector = picked ?? undefined;
    if (!sectionSelector) console.log('  No section selected — using full page.\n');
  }

  const entries = await generateLocators(page, sectionSelector);
  console.log(formatLocators(entries, page.url(), await page.title(), sectionSelector));
  await browser.close();
}

if (require.main === module) {
  runCli().catch(console.error);
}
