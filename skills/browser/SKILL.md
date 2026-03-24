---
name: Browser
description: Open a browser and perform operations described in plain text. Starts a hybrid session where the LLM executes tasks and the user can act simultaneously. All actions are recorded to a flow YAML file. Use when the user wants to automate, test, or interact with any website.
---

# Browser Automation — Hybrid Session

You operate in **hybrid mode**: you (the LLM) execute browser actions via Playwright MCP tools, while the user can interact with the browser window directly at the same time. All actions from both sides are recorded.

## Starting a Session

When invoked with a task:
1. Use `browser_navigate` to open the target URL
2. Call `browser_snapshot` to get the accessibility tree (page context)
3. Use `browser_screenshot` to see the current state visually
4. Parse the snapshot to identify interactive elements
5. Execute each action step by step

## Page Context — Read Before Acting

Before each action, get page context:
```
browser_snapshot  →  accessibility tree (roles, names, locators)
browser_screenshot  →  visual state
```

From the snapshot, identify elements by:
- Preferred: role + accessible name (e.g., button "Sign in")
- Fallback: label text, placeholder, visible text

## Action Sequence

For each logical step:
1. **Identify** the target element from the snapshot
2. **Act** using the appropriate MCP tool
3. **Verify** with a screenshot or snapshot after the action
4. **Repeat** until the task is complete

## Available MCP Tools (Playwright)

| Tool | When to use |
|------|-------------|
| `browser_navigate` | Go to a URL |
| `browser_click` | Click a button, link, checkbox |
| `browser_type` | Type text into an input |
| `browser_select_option` | Choose from a dropdown |
| `browser_snapshot` | Get accessibility tree (do this before acting) |
| `browser_screenshot` | Take a screenshot |
| `browser_press_key` | Press Enter, Tab, Escape, etc. |
| `browser_hover` | Hover over an element |
| `browser_wait_for` | Wait for element to appear |
| `browser_scroll` | Scroll the page |
| `browser_close` | Close the browser |

## Get Locators On Demand

If the user asks **"get locators"** or **"show locators"** or **"what are the locators"**:
1. Run in terminal: `npx flint pom` (uses the current active session page)
2. Or use `browser_evaluate` to run inline locator extraction
3. Print results inline as:
   ```
   element_name        CSS: [data-testid="..."]    [95]
                            XPath: //input[@data-testid="..."]
   ```

## Recording

All your actions are being recorded automatically to a flow YAML in `flows/`. You do not need to manually record — the system does it. The user's manual actions are also captured via CDP listeners in the same file.

## Completing the Task

When done:
- Take a final screenshot to confirm
- Tell the user what was accomplished
- Mention the flow file path so they can replay it later: `flows/<name>.yaml`

## Error Handling

- If an element is not found, take a screenshot and describe what you see
- Try alternative selectors (role → label → text → CSS)
- If a page changes unexpectedly, get a new snapshot before continuing
- Never guess — always verify with snapshot or screenshot
