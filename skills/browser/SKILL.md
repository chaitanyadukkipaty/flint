---
name: Browser
description: Open a browser and perform operations described in plain text. Starts a hybrid session where the LLM executes tasks and the user can act simultaneously. All actions are recorded to a flow YAML file. Use when the user wants to automate, test, or interact with any website.
---

# Browser Automation — Hybrid Session

You operate in **hybrid mode**: you (the LLM) execute browser actions via Playwright MCP tools, while the user can interact with the browser window directly at the same time. All actions from both sides are recorded.

## Action Strategy — Priority Order

For every interaction, follow this order and move to the next level only if the previous fails:

### Level 1 — Snapshot (preferred)
```
browser_snapshot  →  find element ref  →  browser_click / browser_type (using ref)
```
Get the accessibility tree, identify the element by role + name, act using its `ref`.

### Level 2 — Screenshot + Coordinates (fallback)
When `browser_snapshot` does not expose the target element (canvas, custom components, shadow DOM, iframes, dynamic overlays):

1. Call `browser_screenshot` and visually locate the element
2. Estimate its center coordinates `(x, y)` from the screenshot dimensions
3. Use `browser_run_code` to act at those coordinates:

**Click:**
```javascript
async (page) => { await page.mouse.click(x, y); }
```

**Double-click:**
```javascript
async (page) => { await page.mouse.dblclick(x, y); }
```

**Type into a coordinate-clicked field:**
```javascript
async (page) => {
  await page.mouse.click(x, y);
  await page.keyboard.type('your text');
}
```

**Hover:**
```javascript
async (page) => { await page.mouse.move(x, y); }
```

**Drag:**
```javascript
async (page) => {
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY);
  await page.mouse.up();
}
```

### Level 3 — JavaScript evaluation (last resort)
When neither snapshot nor coordinates work (invisible triggers, programmatic actions):
```javascript
async (page) => {
  await page.evaluate(() => {
    document.querySelector('selector').click();
  });
}
```

## Starting a Session

When invoked with a task:
1. `browser_navigate` to the target URL
2. `browser_snapshot` to get the accessibility tree
3. If snapshot is insufficient → `browser_screenshot` for visual context
4. Execute actions using the appropriate level above
5. Verify each action with a snapshot or screenshot before continuing

## Available MCP Tools

| Tool | When to use |
|------|-------------|
| `browser_navigate` | Go to a URL |
| `browser_snapshot` | Get accessibility tree — always try this first |
| `browser_screenshot` | Visual state — use when snapshot is insufficient |
| `browser_click` | Click using snapshot ref |
| `browser_type` | Type using snapshot ref |
| `browser_run_code` | Coordinate clicks, drags, keyboard combos, JS actions |
| `browser_select_option` | Choose from a dropdown |
| `browser_press_key` | Press Enter, Tab, Escape, etc. |
| `browser_hover` | Hover using snapshot ref |
| `browser_wait_for` | Wait for element to appear |
| `browser_scroll` | Scroll the page |
| `browser_evaluate` | Run JS on a specific element ref |

## Get Locators On Demand

If the user asks **"get locators"** or **"show locators"**:
```bash
npx flint pom
```
Prints CSS + XPath for all interactive elements with resilience scores.

## Recording

All actions are recorded automatically to `flows/`. Manual user actions are captured via CDP listeners in the same file.

## Completing the Task

When done:
- Take a final `browser_screenshot` to confirm the result
- Tell the user what was accomplished
- Mention the flow file: `flows/<name>.yaml`

## Error Handling

1. Element not found in snapshot → take screenshot, try coordinate click
2. Coordinate click missed → re-examine screenshot, adjust coordinates
3. Page changed unexpectedly → `browser_snapshot` again before retrying
4. Never guess coordinates blindly — always take a screenshot first to estimate them
