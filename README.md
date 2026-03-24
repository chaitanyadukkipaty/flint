# flint

Hybrid browser automation for Claude Code. Record browser flows with an LLM and a human acting on the same live browser simultaneously, replay them with automatic LLM self-healing when locators break, and extract resilient CSS/XPath locators on demand.

## Features

- **Hybrid recording** — LLM (via Playwright MCP) and user act on the same live browser at the same time; every action from both sides is saved to a YAML flow file
- **LLM self-healing replay** — when a locator breaks during replay, `flint` calls `claude --print` to inspect the live DOM and find an alternative selector, retries the step, and writes the fix back to the YAML
- **Resilient locators** — CSS + XPath generated with a priority-based scoring system (`data-testid` → `aria-label` → stable id → label → name → placeholder → type → class → position)
- **Claude Code skills** — `/browser` and `/browser-replay` skills included; install them with `flint init`

## Requirements

- Node 18+
- [Claude Code](https://claude.ai/code) CLI installed and authenticated
- Playwright browsers: `npx playwright install chromium`

## Installation

```bash
npm install -g flint
# or as a project dependency
npm install flint
```

## Setup

Run once per project:

```bash
flint init
```

This:
1. Copies `/browser` and `/browser-replay` Claude Code skills into `.claude/skills/`
2. Writes `.mcp.json` pointing to the Playwright MCP server
3. Creates the `flows/` directory

Then in Claude Code, reconnect the MCP server:
```
/mcp → Reconnect playwright
```

## Usage

### Start a hybrid session

```bash
flint session "checkout flow"
```

A headed browser opens. You can interact with it manually while Claude Code drives it via `/browser` commands — both sides record to the same YAML.

**In Claude Code:**
```
/browser go to github.com and search for playwright
```

**In the session terminal:**
```
locators    → print resilient CSS/XPath for all interactive elements
save        → confirm the flow file path and step count
quit        → end session and restore .mcp.json
```

### Replay a flow

```bash
flint replay flows/checkout-flow.yaml
```

Steps are replayed in order. If a locator fails:
1. The live DOM is captured
2. `claude --print` is called with the failed step context
3. Claude suggests a new CSS selector
4. The step is retried
5. The YAML is patched so future replays use the healed locator

### Get locators for a page

```bash
flint pom https://example.com
```

Prints every interactive element with CSS + XPath and a resilience score:

```
Page: Example Domain | https://example.com

search_input             CSS: input[name="q"]                               [75]
                              XPath: //input[@name="q"]

submit_button            CSS: [data-testid="search-submit"]                 [95]
                              XPath: //button[@data-testid="search-submit"]

sign_in_link  ⚠          CSS: a.nav-link                                    [40]
                              XPath: //a[contains(@class,"nav-link")]
```

## Flow YAML format

```yaml
name: checkout flow
source: hybrid
recorded_at: '2026-03-24T10:00:00.000Z'
steps:
  - id: 1
    actor: user
    action: navigate
    url: https://example.com
    timestamp: '2026-03-24T10:00:01.000Z'
  - id: 2
    actor: llm
    action: click
    element:
      name: add_to_cart
      css: '[data-testid="add-to-cart"]'
      xpath: //button[@data-testid="add-to-cart"]
      resilience: 95
    timestamp: '2026-03-24T10:00:03.000Z'
```

`actor` is either `llm` (Claude Code via MCP) or `user` (manual interaction captured via CDP).

## Programmatic API

```ts
import { generateLocators, formatLocators, FlowRecorder } from 'flint';

// Generate locators for any Playwright page
const entries = await generateLocators(page);
console.log(formatLocators(entries, page.url(), await page.title()));

// Record a flow manually
const recorder = new FlowRecorder('flows/my-flow.yaml', 'my flow');
recorder.append({ actor: 'llm', action: 'navigate', url: 'https://example.com' });
```

## How self-healing works

When `flint replay` encounters a failure:

```
  ✗ Step 3 failed: locator '[data-testid="login-btn"]' not found
  🔧 Asking LLM for alternative locator...
  💡 Matched the sign-in button by its aria-label "Sign in"
     New CSS: button[aria-label="Sign in"]
  ✓ Healed and retried successfully

✅ Flow updated with healed locators: flows/login-flow.yaml
```

No API key needed — uses your existing Claude Code authentication via `claude --print`.

## License

MIT
