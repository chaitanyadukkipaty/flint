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
exports.loadConfig = void 0;
/**
 * init.ts — one-time project setup for flint.
 * Asks which AI assistant the user is using and configures accordingly.
 * Run: flint init
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const readline = __importStar(require("readline"));
const config_1 = require("./config");
Object.defineProperty(exports, "loadConfig", { enumerable: true, get: function () { return config_1.loadConfig; } });
const CONFIG_FILE = '.flint.json';
const COPILOT_INSTRUCTIONS = `## Browser Automation (flint)

This project uses [flint](https://github.com/chaitanyadukkipaty/flint) for hybrid browser automation.
A Playwright MCP server is configured — use it to control a live browser directly from chat.

### Start a session
Run in terminal before using browser tools:
\`\`\`
flint session [optional-flow-name]
\`\`\`
Then reload the MCP server in your editor.

### Browser tools available via MCP

| Tool | Use for |
|------|---------|
| \`browser_navigate\` | Go to a URL |
| \`browser_snapshot\` | Get accessibility tree (do this before acting) |
| \`browser_screenshot\` | See the current page visually |
| \`browser_click\` | Click buttons, links, checkboxes |
| \`browser_type\` | Type text into inputs |
| \`browser_press_key\` | Press Enter, Tab, Escape, etc. |
| \`browser_select_option\` | Choose from dropdowns |
| \`browser_scroll\` | Scroll the page |
| \`browser_hover\` | Hover over elements |

### Page context strategy
Before every action: call \`browser_snapshot\` to get the accessibility tree, then identify elements by role + name. Fall back to label, placeholder, or visible text.

### Get resilient locators
\`\`\`
flint pom <url>
\`\`\`
Outputs CSS + XPath for all interactive elements with resilience scores.

### Replay a recorded flow
\`\`\`
flint replay flows/<name>.yaml
\`\`\`
Failed locators are automatically healed and saved back to the YAML.
`;
function ask(rl, question) {
    return new Promise(resolve => rl.question(question, resolve));
}
function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory())
            copyDir(srcPath, destPath);
        else
            fs.copyFileSync(srcPath, destPath);
    }
}
function writeIfAbsent(filePath, content, label) {
    if (!fs.existsSync(filePath)) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
        console.log(`  ✅ ${label}`);
    }
    else {
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
    let choice;
    while (true) {
        choice = (await ask(rl, 'Enter 1, 2, or 3: ')).trim();
        if (['1', '2', '3'].includes(choice))
            break;
        console.log('  Please enter 1, 2, or 3.');
    }
    const assistant = choice === '1' ? 'claude' : choice === '2' ? 'copilot' : 'both';
    const useClaude = assistant === 'claude' || assistant === 'both';
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
        writeIfAbsent(path.join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { playwright: mcpEntry } }, null, 2) + '\n', '.mcp.json');
    }
    // VS Code Copilot
    if (useCopilot) {
        writeIfAbsent(path.join(cwd, '.vscode', 'mcp.json'), JSON.stringify({ servers: { playwright: mcpEntry } }, null, 2) + '\n', '.vscode/mcp.json');
        writeIfAbsent(path.join(cwd, '.github', 'copilot-instructions.md'), COPILOT_INSTRUCTIONS, '.github/copilot-instructions.md');
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
