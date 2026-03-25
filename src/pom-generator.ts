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
export async function pickSection(page: Page): Promise<{ selector: string | null; entries: LocatorEntry[] }> {
  console.log('\n  Section picker active — hover to highlight, click to select.');
  console.log('  Click the [⏸ Pause Picker] button (top-right) to open hover menus, then Resume.\n');

  return page.evaluate(() => new Promise<{ selector: string | null; entries: any[] }>(resolve => {
    // All picker UI elements carry data-picker-ui so handlers can skip them
    const highlight = document.createElement('div');
    (highlight as HTMLElement).dataset.pickerUi = '1';
    highlight.style.cssText = [
      'position:fixed', 'pointer-events:none', 'z-index:2147483646',
      'outline:3px solid #f97316', 'background:rgba(249,115,22,0.08)',
      'transition:top 0.06s,left 0.06s,width 0.06s,height 0.06s', 'border-radius:3px',
    ].join(';');

    const label = document.createElement('div');
    (label as HTMLElement).dataset.pickerUi = '1';
    label.style.cssText = [
      'position:fixed', 'bottom:16px', 'left:50%', 'transform:translateX(-50%)',
      'background:#1e293b', 'color:#f8fafc', 'padding:8px 16px',
      'border-radius:6px', 'font:13px/1.4 monospace', 'z-index:2147483647',
      'pointer-events:none', 'white-space:nowrap',
    ].join(';');
    label.textContent = 'Click to select section • Click [Pause] to open hover menus • Esc = full page';

    const btn = document.createElement('button');
    (btn as HTMLElement).dataset.pickerUi = '1';
    btn.textContent = '⏸ Pause Picker';
    btn.style.cssText = [
      'position:fixed', 'top:16px', 'right:16px', 'z-index:2147483647',
      'background:#1e293b', 'color:#f8fafc', 'padding:8px 16px',
      'border-radius:6px', 'font:13px/1.4 monospace', 'border:2px solid #f97316', 'cursor:pointer',
    ].join(';');

    document.body.append(highlight, label, btn);
    document.body.style.cursor = 'crosshair';
    let paused = false;

    btn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation(); e.preventDefault();
      paused = !paused;
      if (paused) {
        highlight.style.display = 'none';
        btn.textContent = '▶ Resume Picker';
        (btn as HTMLElement).style.background = '#dc2626';
        document.body.style.cursor = 'default';
        label.textContent = 'Picker paused — hover to open menus, then click Resume';
      } else {
        highlight.style.display = '';
        btn.textContent = '⏸ Pause Picker';
        (btn as HTMLElement).style.background = '#1e293b';
        document.body.style.cursor = 'crosshair';
        label.textContent = 'Click to select section • Click [Pause] to open hover menus • Esc = full page';
      }
    });

    function buildSelector(el: Element): string {
      const e = el as HTMLElement;
      if (e.id && !/^\d|react-|ember/.test(e.id)) return `#${CSS.escape(e.id)}`;
      const testId = e.getAttribute('data-testid') ?? e.getAttribute('data-cy') ?? '';
      if (testId) return `[data-testid="${testId}"]`;
      const ariaLabel = e.getAttribute('aria-label') ?? '';
      if (ariaLabel) return `${e.tagName.toLowerCase()}[aria-label="${ariaLabel}"]`;
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
      let el: Element | null = target;
      while (el && el !== document.body) {
        if ((el as HTMLElement).dataset?.pickerUi) { el = el.parentElement; continue; }
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

    function cleanup() {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.cursor = '';
      highlight.remove(); label.remove(); btn.remove();
    }

    function onOver(e: MouseEvent) {
      if (paused) return;
      const target = e.target as Element;
      if (!target || (target as HTMLElement).dataset?.pickerUi) return;
      const section = getBlockAncestor(target);
      if (section === document.body) return;
      const r = section.getBoundingClientRect();
      highlight.style.top = `${r.top}px`;
      highlight.style.left = `${r.left}px`;
      highlight.style.width = `${r.width}px`;
      highlight.style.height = `${r.height}px`;
      label.textContent = `<${section.tagName.toLowerCase()}${section.id ? '#'+section.id : ''}> — click to select`;
    }

    function extractLocators(root: Element): any[] {
      // Broad selector — includes ARIA roles, tabindex, onclick, custom interactive elements
      const INTERACTIVE_SELECTORS =
        'input, button, a[href], select, textarea, details, summary, ' +
        '[role="button"], [role="link"], [role="textbox"], [role="checkbox"], ' +
        '[role="combobox"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], ' +
        '[role="menuitemradio"], [role="option"], [role="switch"], [role="treeitem"], ' +
        '[role="gridcell"], [role="row"], [tabindex]:not([tabindex="-1"]), [onclick]';

      function isVisible(el: Element): boolean {
        const r = (el as HTMLElement).getBoundingClientRect(), s = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 &&
          parseFloat(s.opacity) > 0 &&
          s.visibility !== 'hidden' &&
          s.display !== 'none';
      }

      // Check if a portaled element is positioned near the section (dropdown proximity).
      // Horizontally must share x-range with the section.
      // Vertically must start within 2× the section's height above or below it.
      function nearSection(el: Element, sr: DOMRect): boolean {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const hBuffer = Math.max(sr.height * 2, 80);
        const hOverlap = r.left < sr.right && r.right > sr.left;
        const vNear = r.top < sr.bottom + hBuffer && r.bottom > sr.top - hBuffer;
        return hOverlap && vNear;
      }

      function snake(str: string): string {
        return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'element';
      }
      function isAutoId(id: string): boolean {
        return /^(react-|ember|__|\d|uid|comp|el-)/.test(id) || /\d{4,}/.test(id);
      }
      function esc(v: string): string { return v.replace(/'/g, "\\'").replace(/"/g, '\\"'); }
      function cssPath(el: HTMLElement): string {
        const parts: string[] = []; let cur: HTMLElement | null = el;
        while (cur && cur !== document.body) {
          const tag = cur.tagName.toLowerCase();
          const sibs = cur.parentElement ? Array.from(cur.parentElement.children).filter(c => c.tagName === cur!.tagName) : [];
          parts.unshift(sibs.length > 1 ? `${tag}:nth-of-type(${sibs.indexOf(cur)+1})` : tag);
          cur = cur.parentElement as HTMLElement | null; if (parts.length >= 4) break;
        }
        return parts.join(' > ');
      }
      function xpathFor(el: HTMLElement): string {
        const parts: string[] = []; let cur: HTMLElement | null = el;
        while (cur && cur !== document.body) {
          const tag = cur.tagName.toLowerCase();
          const sibs = cur.parentElement ? Array.from(cur.parentElement.children).filter(c => c.tagName === cur!.tagName) : [];
          parts.unshift(sibs.length > 1 ? `${tag}[${sibs.indexOf(cur)+1}]` : tag);
          cur = cur.parentElement as HTMLElement | null; if (parts.length >= 4) break;
        }
        return '//' + parts.join('/');
      }

      // Returns true if el has a positioned (absolute/fixed) ancestor outside of root —
      // i.e. it lives in a portal/dropdown that floated out of the DOM subtree.
      function isInFloatingContainer(el: HTMLElement): boolean {
        let cur: HTMLElement | null = el.parentElement;
        while (cur && cur !== document.body) {
          if (root.contains(cur)) return false; // re-entered root subtree, not a portal
          const s = window.getComputedStyle(cur);
          if ((s.position === 'fixed' || s.position === 'absolute') && parseInt(s.zIndex || '0') > 0) return true;
          cur = cur.parentElement;
        }
        return false;
      }

      const isFullPage = root === document.body;
      const sectionRect = root.getBoundingClientRect();
      const seen = new Set<string>(), entries: any[] = [];

      document.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTORS).forEach(el => {
        if ((el as HTMLElement).dataset?.pickerUi) return;
        if (!isVisible(el)) return;
        if (!isFullPage) {
          const inRoot = root.contains(el);
          // Include if it's a DOM child, OR if it's in a floating portal near the section
          if (!inRoot && !(isInFloatingContainer(el) && nearSection(el, sectionRect))) return;
        }

        const tag = el.tagName.toLowerCase(), type = el.getAttribute('type') ?? '';
        const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-cy') ?? el.getAttribute('data-qa') ?? '';
        const ariaLabel = el.getAttribute('aria-label') ?? '', id = el.getAttribute('id') ?? '';
        const labelEl = id ? document.querySelector<HTMLElement>(`label[for="${id}"]`) : null;
        const labelText = labelEl?.innerText?.trim() ?? '', innerText = el.innerText?.trim().slice(0, 60) ?? '';
        const placeholder = el.getAttribute('placeholder') ?? '', name = el.getAttribute('name') ?? '';
        const role = el.getAttribute('role') ?? '';
        const cls = Array.from(el.classList).filter(c => !/\d{3,}/.test(c)).slice(0, 2).join('.');
        let css = '', xpath = '', resilience = 0, fragile = false, humanName = '';

        if (testId) { const a = el.getAttribute('data-testid') ? 'data-testid' : el.getAttribute('data-cy') ? 'data-cy' : 'data-qa'; css = `[${a}="${esc(testId)}"]`; xpath = `//${tag}[@${a}="${esc(testId)}"]`; resilience = 95; humanName = snake(testId); }
        else if (ariaLabel) { css = `${tag}[aria-label="${esc(ariaLabel)}"]`; xpath = `//${tag}[@aria-label="${esc(ariaLabel)}"]`; resilience = 90; humanName = snake(ariaLabel); }
        else if (id && !isAutoId(id)) { css = `#${CSS.escape(id)}`; xpath = `//${tag}[@id="${esc(id)}"]`; resilience = 85; humanName = snake(id); }
        else if (labelText) { css = id ? `#${CSS.escape(id)}` : `${tag}[name="${esc(name||id)}"]`; xpath = `//label[normalize-space()="${esc(labelText)}"]/following-sibling::${tag}[1]`; resilience = 80; humanName = snake(labelText) + (tag === 'input' ? '_input' : ''); }
        else if (name) { css = `${tag}[name="${esc(name)}"]`; xpath = `//${tag}[@name="${esc(name)}"]`; resilience = 75; humanName = snake(name); }
        else if (placeholder) { css = `${tag}[placeholder="${esc(placeholder)}"]`; xpath = `//${tag}[@placeholder="${esc(placeholder)}"]`; resilience = 70; humanName = snake(placeholder) + '_input'; }
        else if (role && role !== 'none' && role !== 'presentation' && innerText) { css = cssPath(el); xpath = `//*[@role="${role}" and normalize-space()="${esc(innerText)}"]`; resilience = 65; humanName = snake(innerText + '_' + role); }
        else if (role && role !== 'none' && role !== 'presentation') { css = cssPath(el); xpath = `//*[@role="${role}"]`; resilience = 60; humanName = snake(role) + '_el'; }
        else if (type && (tag === 'input' || tag === 'button')) { css = `${tag}[type="${type}"]`; xpath = `//${tag}[@type="${type}"]`; resilience = 60; humanName = snake(type+'_'+tag); }
        // Use structural CSS path (unique per element) + text XPath for links and buttons with text
        else if (tag === 'button' && innerText) { css = cssPath(el); xpath = `//button[normalize-space()="${esc(innerText)}"]`; resilience = 60; humanName = snake(innerText) + '_button'; }
        else if (tag === 'a' && innerText) { css = cssPath(el); xpath = `//a[normalize-space()="${esc(innerText)}"]`; resilience = 60; humanName = snake(innerText) + '_link'; }
        else if (cls) { css = `${tag}.${cls}`; xpath = `//${tag}[contains(@class,"${cls.split('.')[0]}")]`; resilience = 40; fragile = true; humanName = snake(cls.split('.')[0] || tag); }
        else { css = cssPath(el); xpath = xpathFor(el); resilience = 20; fragile = true; humanName = snake(innerText || tag) + '_el'; }

        if (!css || seen.has(css)) return;
        seen.add(css);
        entries.push({ name: humanName, css, xpath, resilience, fragile });
      });
      return entries.sort((a, b) => b.resilience - a.resilience);
    }

    function onClick(e: MouseEvent) {
      if (paused) return;
      const target = e.target as HTMLElement;
      if (target?.dataset?.pickerUi) return;
      e.preventDefault(); e.stopPropagation();
      const section = getBlockAncestor(target ?? document.body);
      const selector = section === document.body ? null : buildSelector(section);
      // Extract locators NOW while the DOM is still in its current state (dropdown open)
      const entries = extractLocators(section === document.body ? document.body : section);
      cleanup();
      resolve({ selector, entries });
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (paused) {
          // Resume picker
          paused = false;
          highlight.style.display = '';
          btn.textContent = '⏸ Pause Picker';
          (btn as HTMLElement).style.background = '#1e293b';
          document.body.style.cursor = 'crosshair';
          label.textContent = 'Click to select section • Click [Pause] to open hover menus • Esc = full page';
        } else {
          cleanup(); resolve({ selector: null, entries: extractLocators(document.body) });
        }
      }
    }

    document.addEventListener('mouseover', onOver);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
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
        css = buildCssPath(el);
        xpath = `//button[normalize-space()="${escAttr(innerText)}"]`;
        resilience = 60;
        humanName = toSnakeCase(innerText) + '_button';
      } else if (tag === 'a' && innerText) {
        css = buildCssPath(el);
        xpath = `//a[normalize-space()="${escAttr(innerText)}"]`;
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

/** Convert a simple structural CSS selector to an XPath expression */
function cssToXPath(css: string): string {
  const parts = css.split(/\s*>\s*/);
  const xparts = parts.map(part => {
    const nth = part.match(/^(\w+):nth-of-type\((\d+)\)$/);
    if (nth) return `${nth[1]}[${nth[2]}]`;
    if (part.startsWith('#')) return `*[@id="${part.slice(1)}"]`;
    const attrM = part.match(/^\[([^\]]+)\]$/);
    if (attrM) return `*[@${attrM[1]}]`;
    return part;
  });
  return '//' + xparts.join('/');
}

export function formatLocators(entries: LocatorEntry[], url: string, title: string, sectionSelector?: string): string {
  const scope = sectionSelector ? ` (section: ${sectionSelector})` : '';
  const header = `Page: ${title} | ${url}${scope}\n`;

  // Prepend the section container itself as a locator entry
  const isFragile = sectionSelector ? /nth-of-type|:nth-child/.test(sectionSelector) : false;
  const all: LocatorEntry[] = sectionSelector
    ? [
        {
          name: (sectionSelector.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase().slice(0, 40) || 'section') + '_section',
          css: sectionSelector,
          xpath: cssToXPath(sectionSelector),
          resilience: isFragile ? 20 : 60,
          fragile: isFragile,
        },
        ...entries,
      ]
    : entries;

  const lines = all.map(e => {
    const flag = e.fragile ? ' ⚠' : '';
    return (
      `${e.name.padEnd(28)} CSS: ${e.css.padEnd(50)} [${e.resilience}]${flag}\n` +
      `${''.padEnd(28)}      XPath: ${e.xpath}`
    );
  });
  return header + '\n' + lines.join('\n\n');
}

export async function runCli() {
  const { stealthChromium: chromium, stealthArgs, stealthContextOptions, applyStealthToContext } = require('./stealth');
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
  const context = await browser.newContext(stealthContextOptions);
  await applyStealthToContext(context);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });

  let sectionSelector: string | undefined;
  if (explicitSelector) {
    sectionSelector = explicitSelector;
  } else if (wantsSection) {
    const { selector, entries: pickedEntries } = await pickSection(page);
    sectionSelector = selector ?? undefined;
    if (!sectionSelector) console.log('  No section selected — using full page.\n');
    const sorted = pickedEntries.sort((a, b) => b.resilience - a.resilience);
    console.log(formatLocators(sorted, page.url(), await page.title(), sectionSelector));
    await browser.close();
    return;
  }

  const entries = await generateLocators(page, sectionSelector);
  console.log(formatLocators(entries, page.url(), await page.title(), sectionSelector));
  await browser.close();
}

if (require.main === module) {
  runCli().catch(console.error);
}
