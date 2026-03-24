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
exports.getOrCreateSession = getOrCreateSession;
exports.getActiveSession = getActiveSession;
exports.closeSession = closeSession;
/**
 * browser-session.ts
 * Manages a single shared headed Playwright browser instance.
 * Both LLM (via MCP) and user (via CDP) operate on this session.
 */
const playwright_1 = require("playwright");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
let activeSession = null;
async function getOrCreateSession(flowName) {
    if (activeSession)
        return activeSession;
    const browser = await playwright_1.chromium.launch({ headless: false });
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
function getActiveSession() {
    return activeSession;
}
async function closeSession() {
    if (activeSession) {
        await activeSession.browser.close();
        activeSession = null;
    }
}
