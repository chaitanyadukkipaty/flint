/**
 * browser-session.ts
 * Manages a single shared headed Playwright browser instance.
 * Both LLM (via MCP) and user (via CDP) operate on this session.
 */
import { Browser, BrowserContext, Page, chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

export interface SessionState {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  sessionId: string;
  flowPath: string;
}

let activeSession: SessionState | null = null;

export async function getOrCreateSession(flowName?: string): Promise<SessionState> {
  if (activeSession) return activeSession;

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const sessionId = Date.now().toString();
  const name = flowName ?? `flow-${sessionId}`;
  const flowDir = path.join(process.cwd(), 'flows');
  const screenshotDir = path.join(flowDir, 'screenshots');

  fs.mkdirSync(screenshotDir, { recursive: true });

  const flowPath = path.join(flowDir, `${name}.yaml`);

  activeSession = { browser, context, page, sessionId, flowPath };
  return activeSession;
}

export function getActiveSession(): SessionState | null {
  return activeSession;
}

export async function closeSession(): Promise<void> {
  if (activeSession) {
    await activeSession.browser.close();
    activeSession = null;
  }
}
