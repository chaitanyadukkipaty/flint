/**
 * session.ts
 * Launches Chrome with a real CDP remote debugging port so both:
 *   - @playwright/mcp (--cdp-endpoint) can control it
 *   - Our manual capture code can listen for user actions
 * on the EXACT same browser instance.
 *
 * Usage:
 *   npm run session                  # auto-named flow
 *   npm run session -- "login flow"  # named flow
 */
import * as os from 'os';
import { stealthChromium as chromium, stealthArgs, stealthContextOptions, applyStealthToContext } from './stealth';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { FlowRecorder } from './flow-recorder';
import { attachManualCapture } from './manual-capture';
import { generateLocators, formatLocators, pickSection } from './pom-generator';
import { suggestLocatorsWithLLM } from './llm-locator';

const FLOW_DIR = path.join(process.cwd(), 'flows');
const MCP_JSON = path.join(process.cwd(), '.mcp.json');
const VSCODE_MCP_JSON = path.join(process.cwd(), '.vscode', 'mcp.json');

// Shell wrapper that sources nvm and runs @playwright/mcp under Node 18+
// __dirname resolves correctly whether run via ts-node (src/) or compiled (dist/)
const MCP_WRAPPER = path.join(__dirname, '..', 'bin', 'playwright-mcp.sh');

const DEFAULT_MCP = {
  mcpServers: {
    playwright: { type: 'stdio', command: MCP_WRAPPER, args: ['--headed'] },
  },
};

const DEFAULT_VSCODE_MCP = {
  servers: {
    playwright: { type: 'stdio', command: MCP_WRAPPER, args: ['--headed'] },
  },
};

function writeMcpJson(cdpEndpoint: string) {
  const args = ['--cdp-endpoint', cdpEndpoint];
  // Claude Code (.mcp.json)
  fs.writeFileSync(MCP_JSON, JSON.stringify(
    { mcpServers: { playwright: { type: 'stdio', command: MCP_WRAPPER, args } } },
    null, 2) + '\n');
  // VS Code Copilot (.vscode/mcp.json)
  if (fs.existsSync(VSCODE_MCP_JSON)) {
    fs.writeFileSync(VSCODE_MCP_JSON, JSON.stringify(
      { servers: { playwright: { type: 'stdio', command: MCP_WRAPPER, args } } },
      null, 2) + '\n');
  }
}

function restoreMcpJson() {
  fs.writeFileSync(MCP_JSON, JSON.stringify(DEFAULT_MCP, null, 2) + '\n');
  if (fs.existsSync(VSCODE_MCP_JSON)) {
    fs.writeFileSync(VSCODE_MCP_JSON, JSON.stringify(DEFAULT_VSCODE_MCP, null, 2) + '\n');
  }
}

/** Fetch the Chrome WS debugger URL from the CDP HTTP endpoint */
function getCdpWsUrl(cdpPort: number): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${cdpPort}/json/version`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data).webSocketDebuggerUrl);
        } catch (e) {
          reject(new Error('Could not parse CDP /json/version response'));
        }
      });
    }).on('error', reject);
  });
}

/** Resolve a CDP URL (http endpoint or ws URL) to a WebSocket debugger URL */
function resolveWsUrl(cdpUrl: string): Promise<string> {
  if (cdpUrl.startsWith('ws')) return Promise.resolve(cdpUrl);
  // Replace localhost with 127.0.0.1 — Node 17+ resolves localhost to ::1 (IPv6)
  // but Chrome's CDP port binds to 127.0.0.1 (IPv4) only.
  const base = cdpUrl.replace(/\/$/, '').replace(/localhost/g, '127.0.0.1');
  return new Promise((resolve, reject) => {
    http.get(`${base}/json/version`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data).webSocketDebuggerUrl); }
        catch { reject(new Error(`Could not parse CDP /json/version from ${base}`)); }
      });
    }).on('error', reject);
  });
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function main() {
  const useLLM = process.env.FLINT_LLM === '1' || process.env.FLINT_LLM === 'true';
  const externalCdpUrl = process.env.FLINT_CDP_URL ?? '';
  const flowName = process.argv[2] ?? `flow-${Date.now()}`;
  const flowSlug = flowName.replace(/\s+/g, '-');
  const flowPath = path.join(FLOW_DIR, `${flowSlug}.yaml`);
  const SCREENSHOT_DIR = path.join(FLOW_DIR, 'screenshots', flowSlug);
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log(`\n🌐 Starting browser session: ${flowName}`);
  console.log(`📄 Recording to: ${flowPath}`);
  console.log(`🤖 LLM locator suggestions: ${useLLM ? 'ON  (use l / sl to trigger)' : 'OFF (pass --llm to enable)'}\n`);

  let context: import('playwright').BrowserContext;
  let page: import('playwright').Page;
  let externalBrowser: import('playwright').Browser | null = null;

  if (externalCdpUrl) {
    // --- Attach to existing browser via CDP ---
    console.log(`🔗 Attaching to existing browser at: ${externalCdpUrl}`);
    const wsUrl = await resolveWsUrl(externalCdpUrl);
    const { chromium: baseChromium } = require('playwright');
    externalBrowser = await baseChromium.connectOverCDP(wsUrl);
    context = externalBrowser!.contexts()[0] ?? await externalBrowser!.newContext();
    writeMcpJson(wsUrl);
    console.log('✅ Attached to browser.');
    console.log('✅ .mcp.json updated with CDP endpoint.');
    console.log('   Reload MCP in Claude Code (/mcp → Reconnect playwright).');
    console.log(`   Then use /browser freely on this browser.\n`);
    console.log('─'.repeat(60));
    console.log(`   CDP: ${externalCdpUrl}`);
    console.log('─'.repeat(60));
  } else {
    // --- Launch new browser ---
    // 1. Get a free port for Chrome's remote debugging (real CDP)
    const cdpPort = await getFreePort();
    const cdpEndpoint = `http://localhost:${cdpPort}`;

    // 2. Launch Chrome using a persistent user-data-dir so the browser
    //    looks like a real returning user (cookies, history, profile signals).
    //    Falls back to bundled Chromium if Chrome is not installed.
    const profileDir = path.join(os.homedir(), '.flint', 'chrome-profile');
    fs.mkdirSync(profileDir, { recursive: true });

    // Remove stale SingletonLock so a new session can start even if a previous one crashed
    const lockFile = path.join(profileDir, 'SingletonLock');
    if (fs.existsSync(lockFile)) {
      try { fs.unlinkSync(lockFile); } catch {}
    }

    const launchOpts = {
      channel: 'chrome' as const,
      headless: false as const,
      args: stealthArgs([`--remote-debugging-port=${cdpPort}`]),
      ...stealthContextOptions,
    };

    try {
      context = await chromium.launchPersistentContext(profileDir, launchOpts);
    } catch {
      // Chrome not installed — fall back to bundled Chromium
      const { channel: _c, ...chromiumOpts } = launchOpts;
      context = await chromium.launchPersistentContext(profileDir, chromiumOpts);
    }

    await applyStealthToContext(context);

    // Fetch the WS debugger URL and auto-update .mcp.json
    // Chrome needs a moment to expose the CDP HTTP endpoint after launch
    await new Promise(r => setTimeout(r, 500));
    const wsDebuggerUrl = await getCdpWsUrl(cdpPort);
    writeMcpJson(wsDebuggerUrl);
    console.log('✅ .mcp.json updated with CDP endpoint.');
    console.log('   Reload MCP in Claude Code (/mcp → Reconnect playwright).');
    console.log(`   Then use /browser freely on this browser.\n`);
    console.log('─'.repeat(60));
    console.log(`   CDP: ${cdpEndpoint}`);
    console.log('─'.repeat(60));
  }

  console.log('');
  console.log('Commands (type in this terminal):');
  console.log('  locators  (l)   → resilient locators for current page');
  console.log('  section   (sl)  → pick a section visually, then show scoped locators');
  console.log('  save      (s)   → confirm flow is saved');
  console.log('  quit      (q)   → end session + restore .mcp.json');
  if (useLLM) console.log('  [LLM mode]      → locators will be filtered by LLM after capture');
  console.log('');

  page = context.pages()[0] ?? await context.newPage();

  // Initialize recorder
  const recorder = new FlowRecorder(flowPath, flowName);

  // Attach manual capture to the initial page
  const cleanupFns: Array<() => unknown> = [];
  cleanupFns.push(await attachManualCapture(page, recorder, SCREENSHOT_DIR, useLLM));

  // Track the most recently active page so l/sl commands operate on the live tab.
  // Also attach capture to any new tabs the user opens.
  const trackPage = (p: import('playwright').Page) => {
    page = p;
    attachManualCapture(p, recorder, SCREENSHOT_DIR, useLLM).then(fn => cleanupFns.push(fn));
    p.on('close', () => {
      const pages = context.pages().filter(pg => !pg.isClosed());
      if (pages.length > 0) page = pages[pages.length - 1];
    });
  };
  context.on('page', trackPage);

  // Auto-shutdown if the external framework closes the browser
  if (externalBrowser) {
    externalBrowser.on('disconnected', () => {
      console.log('\nBrowser disconnected — shutting down.');
      shutdown();
    });
  }

  // 6. REPL
  process.stdin.setEncoding('utf8');
  process.stdin.resume();

  process.stdin.on('data', async (input: string) => {
    const cmd = input.trim().toLowerCase();
    if (cmd === 'locators' || cmd === 'l') {
      try {
        if (useLLM) {
          const { entries, reasoning } = await suggestLocatorsWithLLM(page, SCREENSHOT_DIR);
          if (reasoning) console.log(`  Reasoning: ${reasoning}`);
          console.log('\n' + formatLocators(entries, page.url(), await page.title()) + '\n');
        } else {
          const entries = await generateLocators(page);
          console.log('\n' + formatLocators(entries, page.url(), await page.title()) + '\n');
        }
      } catch (e: any) {
        console.error('Could not get locators:', e.message);
      }
    } else if (cmd === 'section' || cmd === 'sl') {
      try {
        if (useLLM) {
          // Section picker still lets user visually select the area,
          // but LLM generates the locators from SS + DOM context of that section
          const { selector } = await pickSection(page);
          if (!selector) console.log('  No section selected — using full page.\n');
          const { entries, reasoning } = await suggestLocatorsWithLLM(page, SCREENSHOT_DIR, selector ?? undefined);
          if (reasoning) console.log(`  Reasoning: ${reasoning}`);
          console.log('\n' + formatLocators(entries, page.url(), await page.title(), selector ?? undefined) + '\n');
        } else {
          const { selector, entries: raw } = await pickSection(page);
          if (!selector) console.log('  No section selected — using full page.\n');
          const entries = raw.sort((a: any, b: any) => b.resilience - a.resilience);
          console.log('\n' + formatLocators(entries, page.url(), await page.title(), selector ?? undefined) + '\n');
        }
      } catch (e: any) {
        console.error('Could not get section locators:', e.message);
      }
    } else if (cmd === 'save' || cmd === 's') {
      console.log(`\n✅ Flow: ${flowPath} (${recorder.getStepCount()} steps)\n`);
    } else if (cmd === 'quit' || cmd === 'q') {
      await shutdown();
    } else if (cmd) {
      console.log('  Commands: locators | save | quit');
    }
  });

  const shutdown = async () => {
    console.log('\nShutting down...');
    await Promise.all(cleanupFns.map(fn => Promise.resolve(fn())));
    restoreMcpJson();
    if (externalCdpUrl) {
      // Disconnect from external browser without closing it
      try { await externalBrowser?.close(); } catch {}
      console.log('Detached from browser (browser left open).');
    } else {
      await context.close();
    }
    console.log(`Flow saved: ${flowPath} (${recorder.getStepCount()} steps)`);
    console.log('.mcp.json restored.\n');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);

  // Keep alive
  await new Promise(() => {});
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
