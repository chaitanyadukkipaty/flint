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
    const skillsSrc = path.join(__dirname, '..', 'skills');
    if (fs.existsSync(skillsSrc)) {
      copyDir(skillsSrc, path.join(cwd, '.github', 'skills'));
      console.log(`  ✅ .github/skills/ (browser + browser-replay skills)`);
    }
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
