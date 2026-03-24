---
name: Browser Replay
description: Replay a recorded browser flow from a YAML file. Use when the user wants to re-run a previously recorded session, re-execute a browser automation flow, or verify a recorded flow still works.
---

# Browser Replay

Replays a recorded flow YAML file step by step using stored resilient locators.

## Usage

```
/browser-replay flows/my-flow.yaml
```

## How to Run

```bash
npx flint replay flows/<filename>.yaml
```

## What Happens

1. Opens a headed browser
2. Reads the YAML flow file
3. Executes each step in order (navigate, click, type, etc.)
4. Uses stored CSS/XPath locators
5. On failure: asks Claude Code CLI for an alternative selector → retries → patches YAML
6. Logs success/failure per step with healing details
7. Browser stays open for 60s after completion

## Available Flow Files

```bash
ls flows/*.yaml
```

Show a flow:
```bash
cat flows/<filename>.yaml
```
