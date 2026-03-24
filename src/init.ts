/**
 * init.ts — one-time project setup for flint.
 * Sets up Claude Code skills, VS Code Copilot MCP config, and Copilot instructions.
 * Run: flint init
 */
import * as fs from 'fs';
import * as path from 'path';

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
Failed locators are automatically healed using the Claude CLI and saved back to the YAML.
`;

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
    console.log(`✅ ${label} → ${filePath}`);
  } else {
    console.log(`ℹ  ${label} already exists — not overwritten`);
  }
}

function init() {
  const cwd = process.cwd();
  const mcpWrapper = path.join(__dirname, '..', 'bin', 'playwright-mcp.sh');
  const mcpEntry = { type: 'stdio', command: mcpWrapper, args: ['--headed'] };

  // 1. Claude Code skills
  const skillsSrc = path.join(__dirname, '..', 'skills');
  if (fs.existsSync(skillsSrc)) {
    copyDir(skillsSrc, path.join(cwd, '.claude', 'skills'));
    console.log(`✅ Claude Code skills → .claude/skills/`);
  }

  // 2. Claude Code MCP config (.mcp.json)
  writeIfAbsent(
    path.join(cwd, '.mcp.json'),
    JSON.stringify({ mcpServers: { playwright: mcpEntry } }, null, 2) + '\n',
    '.mcp.json (Claude Code)',
  );

  // 3. VS Code Copilot MCP config (.vscode/mcp.json)
  writeIfAbsent(
    path.join(cwd, '.vscode', 'mcp.json'),
    JSON.stringify({ servers: { playwright: mcpEntry } }, null, 2) + '\n',
    '.vscode/mcp.json (VS Code Copilot)',
  );

  // 4. GitHub Copilot workspace instructions
  writeIfAbsent(
    path.join(cwd, '.github', 'copilot-instructions.md'),
    COPILOT_INSTRUCTIONS,
    '.github/copilot-instructions.md',
  );

  // 5. flows directory
  fs.mkdirSync(path.join(cwd, 'flows', 'screenshots'), { recursive: true });
  console.log(`✅ flows/ directory ready`);

  console.log(`
🚀 Setup complete!

Claude Code:
   flint session → /mcp → Reconnect playwright → /browser <task>

VS Code Copilot:
   flint session → Restart MCP server in VS Code → use Copilot Chat with browser tools

Both:
   flint replay flows/<name>.yaml   (self-healing replay)
   flint pom <url>                  (CSS/XPath locators)
`);
}

init();
