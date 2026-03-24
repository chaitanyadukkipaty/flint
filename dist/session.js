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
const playwright_1 = require("playwright");
const net = __importStar(require("net"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const http = __importStar(require("http"));
const flow_recorder_1 = require("./flow-recorder");
const manual_capture_1 = require("./manual-capture");
const pom_generator_1 = require("./pom-generator");
const stealth_1 = require("./stealth");
const FLOW_DIR = path.join(process.cwd(), 'flows');
const SCREENSHOT_DIR = path.join(FLOW_DIR, 'screenshots');
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
function writeMcpJson(cdpEndpoint) {
    const args = ['--cdp-endpoint', cdpEndpoint];
    // Claude Code (.mcp.json)
    fs.writeFileSync(MCP_JSON, JSON.stringify({ mcpServers: { playwright: { type: 'stdio', command: MCP_WRAPPER, args } } }, null, 2) + '\n');
    // VS Code Copilot (.vscode/mcp.json)
    if (fs.existsSync(VSCODE_MCP_JSON)) {
        fs.writeFileSync(VSCODE_MCP_JSON, JSON.stringify({ servers: { playwright: { type: 'stdio', command: MCP_WRAPPER, args } } }, null, 2) + '\n');
    }
}
function restoreMcpJson() {
    fs.writeFileSync(MCP_JSON, JSON.stringify(DEFAULT_MCP, null, 2) + '\n');
    if (fs.existsSync(VSCODE_MCP_JSON)) {
        fs.writeFileSync(VSCODE_MCP_JSON, JSON.stringify(DEFAULT_VSCODE_MCP, null, 2) + '\n');
    }
}
/** Fetch the Chrome WS debugger URL from the CDP HTTP endpoint */
function getCdpWsUrl(cdpPort) {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:${cdpPort}/json/version`, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data).webSocketDebuggerUrl);
                }
                catch (e) {
                    reject(new Error('Could not parse CDP /json/version response'));
                }
            });
        }).on('error', reject);
    });
}
function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
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
    // 2. Launch Chrome with real CDP remote debugging + stealth flags
    const browser = await playwright_1.chromium.launch({
        headless: false,
        channel: 'chrome',
        args: [
            `--remote-debugging-port=${cdpPort}`,
            '--no-first-run',
            '--disable-default-apps',
            ...(0, stealth_1.stealthArgs)(),
        ],
    }).catch(() => 
    // Fall back to bundled Chromium if Chrome is not installed
    playwright_1.chromium.launch({
        headless: false,
        args: [
            `--remote-debugging-port=${cdpPort}`,
            '--no-first-run',
            '--disable-default-apps',
            ...(0, stealth_1.stealthArgs)(),
        ],
    }));
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
    });
    await (0, stealth_1.applyStealthToContext)(context);
    const page = await context.newPage();
    // 3. Initialize recorder
    const recorder = new flow_recorder_1.FlowRecorder(flowPath, flowName);
    // 4. Attach manual capture
    const cleanup = await (0, manual_capture_1.attachManualCapture)(page, recorder, SCREENSHOT_DIR);
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
    console.log('  locators  (l)   → resilient locators for current page');
    console.log('  section   (sl)  → pick a section visually, then show scoped locators');
    console.log('  save      (s)   → confirm flow is saved');
    console.log('  quit      (q)   → end session + restore .mcp.json');
    console.log('');
    // 6. REPL
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('data', async (input) => {
        const cmd = input.trim().toLowerCase();
        if (cmd === 'locators' || cmd === 'l') {
            try {
                const entries = await (0, pom_generator_1.generateLocators)(page);
                console.log('\n' + (0, pom_generator_1.formatLocators)(entries, page.url(), await page.title()) + '\n');
            }
            catch (e) {
                console.error('Could not get locators:', e.message);
            }
        }
        else if (cmd === 'section' || cmd === 'sl') {
            try {
                const selector = await (0, pom_generator_1.pickSection)(page);
                const sectionDesc = selector ?? 'full page';
                if (!selector)
                    console.log('  No section selected — using full page.\n');
                const entries = await (0, pom_generator_1.generateLocators)(page, selector ?? undefined);
                console.log('\n' + (0, pom_generator_1.formatLocators)(entries, page.url(), await page.title(), selector ?? undefined) + '\n');
            }
            catch (e) {
                console.error('Could not get section locators:', e.message);
            }
        }
        else if (cmd === 'save' || cmd === 's') {
            console.log(`\n✅ Flow: ${flowPath} (${recorder.getStepCount()} steps)\n`);
        }
        else if (cmd === 'quit' || cmd === 'q') {
            await shutdown();
        }
        else if (cmd) {
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
    await new Promise(() => { });
}
main().catch(err => {
    console.error(err);
    process.exit(1);
});
