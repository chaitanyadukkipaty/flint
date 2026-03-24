/**
 * init.ts — one-time project setup for flint.
 * Asks which AI assistant the user is using and configures accordingly.
 * Run: flint init
 */
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Assistant, FlintConfig, loadConfig } from './config';

export { loadConfig };

const CONFIG_FILE = '.flint.json';

// ---------------------------------------------------------------------------
// Copilot instructions written to .github/copilot-instructions.md
// Keep in sync with skills/browser/SKILL.md for Claude Code.
// ---------------------------------------------------------------------------
const COPILOT_INSTRUCTIONS = `## Browser Automation (flint)

This project uses [flint](https://github.com/chaitanyadukkipaty/flint) for hybrid browser automation.
A Playwright MCP server is configured — use it to control a live browser directly from chat.

### Start a session
Run in terminal before using browser tools:
\`\`\`
flint session [optional-flow-name]
\`\`\`
Then reload the MCP server (Ctrl+Shift+P → "MCP: Restart Server").

### Action strategy — priority order

For every interaction follow this order, moving to the next level only if the previous fails:

**Level 1 — Snapshot (preferred)**
\`\`\`
browser_snapshot → find element ref → browser_click / browser_type (using ref)
\`\`\`
Get the accessibility tree, identify element by role + name, act using its ref.

**Level 2 — Screenshot + coordinates (fallback)**
When snapshot doesn't expose the target (canvas, shadow DOM, custom components, overlays):
1. Call \`browser_screenshot\` and visually locate the element
2. Estimate its center \`(x, y)\` from the screenshot
3. Act via \`browser_run_code\`:
\`\`\`javascript
async (page) => { await page.mouse.click(x, y); }
// or type after click:
async (page) => { await page.mouse.click(x, y); await page.keyboard.type('text'); }
\`\`\`

**Level 3 — JavaScript evaluation (last resort)**
\`\`\`javascript
async (page) => { await page.evaluate(() => document.querySelector('selector').click()); }
\`\`\`

### Browser tools available via MCP

| Tool | Use for |
|------|---------|
| \`browser_navigate\` | Go to a URL |
| \`browser_snapshot\` | Get accessibility tree — always try first |
| \`browser_screenshot\` | See the current page visually |
| \`browser_click\` | Click using snapshot ref |
| \`browser_type\` | Type using snapshot ref |
| \`browser_run_code\` | Coordinate clicks, drags, JS actions |
| \`browser_press_key\` | Press Enter, Tab, Escape, etc. |
| \`browser_select_option\` | Choose from dropdowns |
| \`browser_scroll\` | Scroll the page |
| \`browser_hover\` | Hover using snapshot ref |
| \`browser_wait_for\` | Wait for element to appear |

### Get resilient locators

**Full page:**
\`\`\`
flint pom <url>
\`\`\`
Outputs CSS + XPath for all interactive elements with resilience scores.

**Scoped to a section (CLI):**
\`\`\`
flint pom <url> --section
\`\`\`
Opens the page, shows a visual picker — hover highlights containers, click to scope.
Or pass a selector directly: \`flint pom <url> --section="#login-form"\`

**Section locators during an active session:**
When the user asks "get locators for a section", "pick a section", or "section locators":

Step 1 — inject the section picker via \`browser_run_code\` and wait for the user to click:
\`\`\`javascript
async (page) => {
  return await page.evaluate(() => new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;cursor:crosshair;pointer-events:all;';
    const hl = document.createElement('div');
    hl.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;outline:3px solid #f97316;background:rgba(249,115,22,0.08);border-radius:3px;transition:all 0.08s;';
    const lbl = document.createElement('div');
    lbl.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#1e293b;color:#f8fafc;padding:8px 16px;border-radius:6px;font:13px/1.4 monospace;z-index:2147483647;pointer-events:none;white-space:nowrap;';
    lbl.textContent = 'Click a section to scope locators \u2022 Esc = full page';
    document.body.append(hl, lbl, overlay);
    function blockAncestor(el) {
      while (el && el !== document.body) {
        const s = window.getComputedStyle(el), r = el.getBoundingClientRect();
        if ((s.display==='block'||s.display==='flex'||s.display==='grid')&&r.width>60&&r.height>30) return el;
        el = el.parentElement;
      }
      return document.body;
    }
    function buildSel(el) {
      if (el.id && !/^\\d|react-|ember/.test(el.id)) return '#' + CSS.escape(el.id);
      const tid = el.getAttribute('data-testid') || el.getAttribute('data-cy') || '';
      if (tid) return '[data-testid="' + tid + '"]';
      const al = el.getAttribute('aria-label') || '';
      if (al) return el.tagName.toLowerCase() + '[aria-label="' + al + '"]';
      const parts = []; let cur = el;
      for (let d = 0; d < 3 && cur && cur !== document.body; d++) {
        const tag = cur.tagName.toLowerCase();
        const sibs = cur.parentElement ? [...cur.parentElement.children].filter(c => c.tagName === cur.tagName) : [];
        parts.unshift(sibs.length > 1 ? tag + ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')' : tag);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }
    overlay.addEventListener('mousemove', e => {
      overlay.style.pointerEvents = 'none';
      const t = document.elementFromPoint(e.clientX, e.clientY);
      overlay.style.pointerEvents = 'all';
      if (!t) return;
      const sec = blockAncestor(t), r = sec.getBoundingClientRect();
      Object.assign(hl.style, { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
      lbl.textContent = '<' + sec.tagName.toLowerCase() + (sec.id ? '#' + sec.id : '') + '> \u2014 click to select \u2022 Esc = full page';
    });
    overlay.addEventListener('click', e => {
      overlay.style.pointerEvents = 'none';
      const t = document.elementFromPoint(e.clientX, e.clientY);
      [overlay, hl, lbl].forEach(n => n.remove());
      resolve(t && blockAncestor(t) !== document.body ? buildSel(blockAncestor(t)) : null);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { [overlay, hl, lbl].forEach(n => n.remove()); resolve(null); }
    }, { once: true });
  }));
}
\`\`\`
Tell the user: **"The section picker is active — hover to highlight containers and click to select. Press Escape for full page."**

Step 2 — once the selector is returned, extract locators scoped to it (replace \`SECTION_SELECTOR\` with the returned value, or \`null\` for full page):
\`\`\`javascript
async (page) => {
  return await page.evaluate((rootSel) => {
    const root = rootSel ? (document.querySelector(rootSel) || document.body) : document.body;
    const SEL = 'input,button,a[href],select,textarea,[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="combobox"],[role="tab"],[role="menuitem"]';
    function vis(el) { const r = el.getBoundingClientRect(), s = window.getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; }
    function esc(v) { return v.replace(/'/g, "\\'").replace(/"/g, '\\"'); }
    function snake(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'element'; }
    function isAutoId(id) { return /^(react-|ember|__|\d|uid|comp|el-)/.test(id) || /\d{4,}/.test(id); }
    const seen = new Set(), out = [];
    root.querySelectorAll(SEL).forEach(el => {
      if (!vis(el)) return;
      const tag = el.tagName.toLowerCase(),
        testId = el.getAttribute('data-testid') || el.getAttribute('data-cy') || '',
        al = el.getAttribute('aria-label') || '', id = el.getAttribute('id') || '',
        nm = el.getAttribute('name') || '', ph = el.getAttribute('placeholder') || '',
        tp = el.getAttribute('type') || '', txt = (el.innerText || '').trim().slice(0, 60),
        labelEl = id ? document.querySelector('label[for="' + id + '"]') : null,
        labelTxt = (labelEl && labelEl.innerText || '').trim();
      let css = '', xpath = '', score = 0, fragile = false, name = '';
      if (testId) { const a = el.getAttribute('data-testid') ? 'data-testid' : 'data-cy'; css = '[' + a + '="' + esc(testId) + '"]'; xpath = '//' + tag + '[@' + a + '="' + esc(testId) + '"]'; score = 95; name = snake(testId); }
      else if (al) { css = tag + '[aria-label="' + esc(al) + '"]'; xpath = '//' + tag + '[@aria-label="' + esc(al) + '"]'; score = 90; name = snake(al); }
      else if (id && !isAutoId(id)) { css = '#' + CSS.escape(id); xpath = '//' + tag + '[@id="' + esc(id) + '"]'; score = 85; name = snake(id); }
      else if (labelTxt) { css = id ? '#' + CSS.escape(id) : tag + '[name="' + esc(nm || id) + '"]'; xpath = '//label[normalize-space()="' + esc(labelTxt) + '"]/following-sibling::' + tag + '[1]'; score = 80; name = snake(labelTxt) + (tag === 'input' ? '_input' : ''); }
      else if (nm) { css = tag + '[name="' + esc(nm) + '"]'; xpath = '//' + tag + '[@name="' + esc(nm) + '"]'; score = 75; name = snake(nm); }
      else if (ph) { css = tag + '[placeholder="' + esc(ph) + '"]'; xpath = '//' + tag + '[@placeholder="' + esc(ph) + '"]'; score = 70; name = snake(ph) + '_input'; }
      else if (tp && (tag === 'input' || tag === 'button')) { css = tag + '[type="' + tp + '"]'; xpath = '//' + tag + '[@type="' + tp + '"]'; score = 60; name = snake(tp + '_' + tag); }
      else if (txt) { css = tag; xpath = '//' + tag + '[normalize-space()="' + esc(txt) + '"]'; score = 60; name = snake(txt) + (tag === 'button' ? '_button' : tag === 'a' ? '_link' : ''); }
      else { score = 20; fragile = true; name = snake(txt || tag) + '_el'; const parts = []; let c = el; for (let d = 0; d < 3 && c && c !== document.body; d++) { const t2 = c.tagName.toLowerCase(), sibs = c.parentElement ? [...c.parentElement.children].filter(x => x.tagName === c.tagName) : []; parts.unshift(sibs.length > 1 ? t2 + ':nth-of-type(' + (sibs.indexOf(c) + 1) + ')' : t2); c = c.parentElement; } css = parts.join(' > '); xpath = '//' + parts.join('/'); }
      if (!css || seen.has(css)) return;
      seen.add(css);
      out.push({ name, css, xpath, score, fragile });
    });
    return out.sort((a, b) => b.score - a.score);
  }, 'SECTION_SELECTOR');
}
\`\`\`

Format and display results as:
\`\`\`
Section: <selector>
─────────────────────────────
element_name    CSS: ...   [score] ⚠
                XPath: ...
\`\`\`

### Replay a recorded flow
\`\`\`
flint replay flows/<name>.yaml
\`\`\`
Failed locators are automatically healed via LLM and saved back to the YAML.
`;

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function writeIfAbsent(filePath: string, content: string, label: string) {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    console.log(`  ✅ ${label}`);
  } else {
    console.log(`  ℹ  ${label} — already exists, skipped`);
  }
}

async function init() {
  const cwd = process.cwd();
  const mcpWrapper = path.join(__dirname, '..', 'bin', 'playwright-mcp.sh');
  const mcpEntry = { type: 'stdio', command: mcpWrapper, args: ['--headed'] };

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n🔥 flint — hybrid browser automation\n');
  console.log('Which AI assistant will you use?\n');
  console.log('  1) Claude Code');
  console.log('  2) VS Code Copilot');
  console.log('  3) Both\n');

  let choice: string;
  while (true) {
    choice = (await ask(rl, 'Enter 1, 2, or 3: ')).trim();
    if (['1', '2', '3'].includes(choice)) break;
    console.log('  Please enter 1, 2, or 3.');
  }

  const assistant: Assistant = choice === '1' ? 'claude' : choice === '2' ? 'copilot' : 'both';
  const useClaude  = assistant === 'claude'  || assistant === 'both';
  const useCopilot = assistant === 'copilot' || assistant === 'both';

  rl.close();

  console.log(`\nSetting up for: ${assistant === 'both' ? 'Claude Code + VS Code Copilot' : assistant === 'claude' ? 'Claude Code' : 'VS Code Copilot'}\n`);

  // Save config
  fs.writeFileSync(path.join(cwd, CONFIG_FILE), JSON.stringify({ assistant }, null, 2) + '\n');
  console.log(`  ✅ .flint.json (preference saved)`);

  // Claude Code
  if (useClaude) {
    const skillsSrc = path.join(__dirname, '..', 'skills');
    if (fs.existsSync(skillsSrc)) {
      copyDir(skillsSrc, path.join(cwd, '.claude', 'skills'));
      console.log(`  ✅ .claude/skills/ (browser + browser-replay skills)`);
    }
    writeIfAbsent(
      path.join(cwd, '.mcp.json'),
      JSON.stringify({ mcpServers: { playwright: mcpEntry } }, null, 2) + '\n',
      '.mcp.json',
    );
  }

  // VS Code Copilot
  if (useCopilot) {
    writeIfAbsent(
      path.join(cwd, '.vscode', 'mcp.json'),
      JSON.stringify({ servers: { playwright: mcpEntry } }, null, 2) + '\n',
      '.vscode/mcp.json',
    );
    writeIfAbsent(
      path.join(cwd, '.github', 'copilot-instructions.md'),
      COPILOT_INSTRUCTIONS,
      '.github/copilot-instructions.md',
    );
  }

  // flows directory (always)
  fs.mkdirSync(path.join(cwd, 'flows', 'screenshots'), { recursive: true });
  console.log(`  ✅ flows/`);

  // Next steps
  console.log('\n🚀 Setup complete!\n');
  if (useClaude) {
    console.log('Claude Code:');
    console.log('  flint session → /mcp → Reconnect playwright → /browser <task>\n');
  }
  if (useCopilot) {
    console.log('VS Code Copilot:');
    console.log('  flint session → Ctrl+Shift+P → "MCP: Restart Server" → use Copilot Chat\n');
  }
  console.log('Both:');
  console.log('  flint replay flows/<name>.yaml   (self-healing replay)');
  console.log('  flint pom <url>                  (CSS/XPath locators)\n');
}

init().catch(err => { console.error(err); process.exit(1); });
