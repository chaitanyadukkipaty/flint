/**
 * init.ts — one-time project setup for flint.
 * Copies Claude Code skills into .claude/skills/ and writes a default .mcp.json.
 * Run: flint init
 */
import * as fs from 'fs';
import * as path from 'path';

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function init() {
  const cwd = process.cwd();

  // 1. Copy skills
  const skillsSrc = path.join(__dirname, '..', 'skills');
  const skillsDest = path.join(cwd, '.claude', 'skills');
  if (fs.existsSync(skillsSrc)) {
    copyDir(skillsSrc, skillsDest);
    console.log(`✅ Skills copied → ${skillsDest}`);
  } else {
    console.warn('⚠ Skills directory not found in package — skipping');
  }

  // 2. Write .mcp.json pointing to this package's shell wrapper
  const mcpPath = path.join(cwd, '.mcp.json');
  const mcpWrapper = path.join(__dirname, '..', 'bin', 'playwright-mcp.sh');
  const mcpConfig = {
    mcpServers: {
      playwright: {
        type: 'stdio',
        command: mcpWrapper,
        args: ['--headed'],
      },
    },
  };

  if (!fs.existsSync(mcpPath)) {
    fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');
    console.log(`✅ .mcp.json created → ${mcpPath}`);
  } else {
    console.log(`ℹ .mcp.json already exists — not overwritten (${mcpPath})`);
  }

  // 3. Create flows directory
  fs.mkdirSync(path.join(cwd, 'flows', 'screenshots'), { recursive: true });
  console.log(`✅ flows/ directory ready`);

  console.log(`
🚀 Setup complete! Next steps:
   1. Start a session:      flint session
   2. Reload MCP in Claude Code: /mcp → Reconnect playwright
   3. Automate the browser: /browser <your task>
   4. Replay a flow:        flint replay flows/<name>.yaml
`);
}

init();
