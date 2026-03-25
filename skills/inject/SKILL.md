---
name: Inject CDP
description: Detect the project's test framework (Playwright, WebdriverIO, Selenium, Nightwatch) and automatically add Chrome remote debugging args so flint can attach via `flint session --cdp`. Use when the user wants to connect flint to their existing test automation.
---

# Inject CDP — Auto-configure Framework for flint Attach

Reads the project's test framework config and adds `--remote-debugging-port=9222` to the Chrome launch args. Once done, the user runs `flint session --cdp http://localhost:9222` in a separate terminal while their tests run to attach flint recording and MCP control.

## Step 1 — Detect the framework

Read `package.json` (in the current working directory). Look in `dependencies` and `devDependencies` for:

| Package | Framework |
|---------|-----------|
| `@playwright/test` | Playwright Test |
| `webdriverio` or `@wdio/cli` | WebdriverIO |
| `selenium-webdriver` | Selenium |
| `nightwatch` | Nightwatch |

If **multiple** frameworks are found, ask the user which one to configure before proceeding.
If **none** are found, tell the user no supported framework was detected and show the manual snippet for their framework.

## Step 2 — Find the config file

### Playwright

Glob for `playwright.config.ts`, `playwright.config.js`, `playwright.config.mts`, `playwright.config.mjs` in the project root and immediate subdirectories.

### WebdriverIO

Glob for `wdio.conf.ts`, `wdio.conf.js`, `wdio.config.ts`, `wdio.config.js`.

### Nightwatch

Glob for `nightwatch.conf.js`, `nightwatch.conf.ts`, `.nightwatchrc.js`, `.nightwatchrc.ts`.

### Selenium

No dedicated config file exists. Use Grep to search for `chrome.Options()` or `require('selenium-webdriver/chrome')` across `*.ts`, `*.js`, `*.mts`, `*.mjs` files. Edit **every** file that instantiates ChromeOptions.

## Step 3 — Read the config file

Read the full config file to understand its current structure before editing. Look for:
- Is `--remote-debugging-port` already present? If yes, skip and tell the user.
- Where exactly to insert the arg.

## Step 4 — Make the surgical edit

Use the **Edit** tool to add the CDP arg. Do NOT reformat or restructure the file — make the smallest possible change.

### Playwright (`playwright.config.ts` / `.js`)

Find the `use: {` block. Add or extend `launchOptions.args`:

**If `launchOptions` already exists with `args`:**
```typescript
// Add to existing args array:
args: ['--existing-arg', '--remote-debugging-port=9222']
```

**If `launchOptions` exists but no `args`:**
```typescript
launchOptions: {
  // existing props...
  args: ['--remote-debugging-port=9222'],
},
```

**If no `launchOptions` in `use`:**
```typescript
use: {
  // existing props...
  launchOptions: {
    args: ['--remote-debugging-port=9222'],
  },
},
```

**If no `use` block at all** (add inside `defineConfig({` or the exported object):
```typescript
use: {
  launchOptions: {
    args: ['--remote-debugging-port=9222'],
  },
},
```

### WebdriverIO (`wdio.conf.js` / `.ts`)

Find `capabilities` array. Add or extend `'goog:chromeOptions'`:

**If `goog:chromeOptions` with `args` exists:**
```javascript
args: ['--existing-arg', '--remote-debugging-port=9222']
```

**If `goog:chromeOptions` exists but no `args`:**
```javascript
'goog:chromeOptions': {
  // existing...
  args: ['--remote-debugging-port=9222'],
},
```

**If no `goog:chromeOptions`** (add inside the capability object where `browserName: 'chrome'`):
```javascript
{
  browserName: 'chrome',
  'goog:chromeOptions': {
    args: ['--remote-debugging-port=9222'],
  },
}
```

### Selenium (Node.js — `selenium-webdriver`)

Find each `chrome.Options()` instantiation. Add the argument on the next line:

```javascript
const options = new chrome.Options();
options.addArguments('remote-debugging-port=9222');  // ← add this line
```

**Important:** Do NOT use the `--` prefix — `selenium-webdriver` adds it automatically. Using `--remote-debugging-port=9222` would result in `----remote-debugging-port=9222`.

### Nightwatch (`nightwatch.conf.js` / `.ts`)

Find `desiredCapabilities`. Add or extend `chromeOptions`:

**Note:** Nightwatch uses `chromeOptions`, NOT `goog:chromeOptions`.

**If `chromeOptions.args` exists:**
```javascript
args: ['--existing-arg', '--remote-debugging-port=9222']
```

**If `chromeOptions` exists but no `args`:**
```javascript
chromeOptions: {
  // existing...
  args: ['--remote-debugging-port=9222'],
},
```

**If no `chromeOptions`** (add inside `desiredCapabilities`):
```javascript
desiredCapabilities: {
  browserName: 'chrome',
  chromeOptions: {
    args: ['--remote-debugging-port=9222'],
  },
},
```

## Step 5 — Report changes and next steps

Tell the user:
1. What file(s) were modified
2. What was changed (show the diff inline)
3. How to use it:

```
Now run your tests normally. In a separate terminal, run:

  flint session [name] --cdp http://localhost:9222

flint will attach to the running browser, record all actions,
and update .mcp.json so you can also control it with /browser.
```

## Edge Cases

- **Port already present** → skip editing, tell the user it's already configured.
- **Multiple capabilities** (WDIO/Nightwatch) → add to the Chrome one only; skip Firefox/Safari.
- **Config not found** → tell the user the file wasn't found and show the manual snippet:
  `flint inject <framework>`
- **Multiple frameworks** → ask which one before editing.
