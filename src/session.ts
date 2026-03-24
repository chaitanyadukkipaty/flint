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
import { chromium } from 'playwright';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { FlowRecorder } from './flow-recorder';
import { attachManualCapture } from './manual-capture';
import { generateLocators, formatLocators } from './pom-generator';

const FLOW_DIR = path.join(process.cwd(), 'flows');
const SCREENSHOT_DIR = path.join(FLOW_DIR, 'screenshots');
const MCP_JSON = path.join(process.cwd(), '.mcp.json');

// Shell wrapper that sources nvm and runs @playwright/mcp under Node 18+
// __dirname resolves correctly whether run via ts-node (src/) or compiled (dist/)
const MCP_WRAPPER = path.join(__dirname, '..', 'bin', 'playwright-mcp.sh');

const DEFAULT_MCP = {
  mcpServers: {
    playwright: {
      type: 'stdio',
      command: MCP_WRAPPER,
      args: ['--headed'],
    },
  },
};

function writeMcpJson(cdpEndpoint: string) {
  const config = {
    mcpServers: {
      playwright: {
        type: 'stdio',
        command: MCP_WRAPPER,
        args: ['--cdp-endpoint', cdpEndpoint],
      },
    },
  };
  fs.writeFileSync(MCP_JSON, JSON.stringify(config, null, 2) + '\n');
}

function restoreMcpJson() {
  fs.writeFileSync(MCP_JSON, JSON.stringify(DEFAULT_MCP, null, 2) + '\n');
}

/** Fetch the Chrome WS debugger URL from the CDP HTTP endpoint */
function getCdpWsUrl(cdpPort: number): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${cdpPort}/json/version`, res => {
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
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const flowName = process.argv[2] ?? `flow-${Date.now()}`;
  const flowPath = path.join(FLOW_DIR, `${flowName.replace(/\s+/g, '-')}.yaml`);

  console.log(`\n🌐 Starting browser session: ${flowName}`);
  console.log(`📄 Recording to: ${flowPath}\n`);

  // 1. Get a free port for Chrome's remote debugging (real CDP)
  const cdpPort = await getFreePort();
  const cdpEndpoint = `http://localhost:${cdpPort}`;

  // 2. Launch Chrome with real CDP remote debugging enabled
  const browser = await chromium.launch({
    headless: false,
    args: [
      `--remote-debugging-port=${cdpPort}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // 3. Initialize recorder
  const recorder = new FlowRecorder(flowPath, flowName);

  // 4. Attach manual capture
  const cleanup = await attachManualCapture(page, recorder, SCREENSHOT_DIR);

  // 5. Fetch the WS debugger URL and auto-update .mcp.json
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
  console.log('');
  console.log('Commands (type in this terminal):');
  console.log('  locators  (l)  → resilient locators for current page');
  console.log('  save      (s)  → confirm flow is saved');
  console.log('  quit      (q)  → end session + restore .mcp.json');
  console.log('');

  // 6. REPL
  process.stdin.setEncoding('utf8');
  process.stdin.resume();

  process.stdin.on('data', async (input: string) => {
    const cmd = input.trim().toLowerCase();
    if (cmd === 'locators' || cmd === 'l') {
      try {
        const entries = await generateLocators(page);
        console.log('\n' + formatLocators(entries, page.url(), await page.title()) + '\n');
      } catch (e: any) {
        console.error('Could not get locators:', e.message);
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
    await cleanup();
    restoreMcpJson();
    await browser.close();
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
