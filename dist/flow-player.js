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
exports.runCli = runCli;
/**
 * flow-player.ts
 * Replays a flow YAML file step by step using Playwright.
 * On step failure, asks the LLM for an alternative locator (healing),
 * retries the step, and saves the corrected locator back to the YAML.
 *
 * Usage: ts-node src/flow-player.ts flows/my-flow.yaml
 */
const playwright_1 = require("playwright");
const fs = __importStar(require("fs"));
const yaml = __importStar(require("js-yaml"));
const path = __importStar(require("path"));
const llm_healer_1 = require("./llm-healer");
const stealth_1 = require("./stealth");
async function replay(flowPath) {
    if (!fs.existsSync(flowPath)) {
        console.error(`Flow file not found: ${flowPath}`);
        process.exit(1);
    }
    const flow = yaml.load(fs.readFileSync(flowPath, 'utf8'));
    // Deduplicate consecutive same-URL navigate steps (artifact of redirect chains)
    const steps = flow.steps.filter((step, i, arr) => {
        if (step.action !== 'navigate')
            return true;
        const prev = arr[i - 1];
        return !(prev?.action === 'navigate' && prev.url === step.url);
    });
    console.log(`\nReplaying: ${flow.name} (${steps.length} steps, ${flow.steps.length - steps.length} duplicates skipped)\n`);
    const browser = await playwright_1.chromium.launch({ headless: false, slowMo: 300, channel: 'chrome', args: (0, stealth_1.stealthArgs)() })
        .catch(() => playwright_1.chromium.launch({ headless: false, slowMo: 300, args: (0, stealth_1.stealthArgs)() }));
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
    });
    await (0, stealth_1.applyStealthToContext)(context);
    const page = await context.newPage();
    let flowMutated = false;
    for (const step of steps) {
        console.log(`  Step ${step.id} [${step.actor}] ${step.action}${step.url ? ' → ' + step.url : ''}`);
        try {
            await executeStep(page, step);
            await page.waitForTimeout(300);
        }
        catch (err) {
            console.error(`  ✗ Step ${step.id} failed: ${err.message}`);
            console.error(`    CSS: ${step.element?.css}`);
            // Attempt LLM healing
            if (step.element) {
                console.log('  🔧 Asking LLM for alternative locator...');
                const healed = await (0, llm_healer_1.healStep)(page, step, err.message);
                if (healed) {
                    console.log(`  💡 ${healed.reasoning}`);
                    console.log(`     New CSS: ${healed.css}`);
                    try {
                        // Patch the step in-place with healed locators
                        step.element.css = healed.css;
                        step.element.xpath = healed.xpath;
                        await executeStep(page, step);
                        await page.waitForTimeout(300);
                        console.log(`  ✓ Healed and retried successfully`);
                        flowMutated = true;
                    }
                    catch (retryErr) {
                        console.error(`  ✗ Healed locator also failed: ${retryErr.message}`);
                    }
                }
                else {
                    console.warn('  ⚠ LLM could not suggest an alternative — skipping step');
                }
            }
        }
    }
    // Persist any healed locators back to the YAML
    if (flowMutated) {
        // Rebuild full flow.steps from (possibly healed) steps array
        // Map by step id so non-deduplicated duplicates stay unchanged
        const idToStep = new Map(steps.map(s => [s.id, s]));
        const updatedSteps = flow.steps.map(s => idToStep.get(s.id) ?? s);
        const updatedFlow = { ...flow, steps: updatedSteps };
        fs.writeFileSync(flowPath, yaml.dump(updatedFlow, { lineWidth: 120 }), 'utf8');
        console.log(`\n✅ Flow updated with healed locators: ${flowPath}\n`);
    }
    console.log('\nReplay complete. Press Ctrl+C to close.\n');
    await page.waitForTimeout(60_000).catch(() => { });
    await browser.close();
}
async function executeStep(page, step) {
    switch (step.action) {
        case 'navigate':
            await page.goto(step.url, { waitUntil: 'domcontentloaded' });
            break;
        case 'click': {
            const loc = page.locator(step.element.css);
            await loc.waitFor({ state: 'visible', timeout: 10_000 });
            await loc.click();
            break;
        }
        case 'type': {
            const loc = page.locator(step.element.css);
            await loc.waitFor({ state: 'visible', timeout: 10_000 });
            await loc.fill(step.value ?? '');
            break;
        }
        case 'select': {
            const loc = page.locator(step.element.css);
            await loc.selectOption(step.value ?? '');
            break;
        }
        case 'keypress':
            await page.keyboard.press(step.key ?? 'Enter');
            break;
        case 'scroll':
            await page.evaluate(() => window.scrollBy(0, 400));
            break;
        case 'hover': {
            const loc = page.locator(step.element.css);
            await loc.hover();
            break;
        }
        default:
            console.warn(`  Unknown action: ${step.action}`);
    }
}
function runCli() {
    const flowPath = process.argv[2];
    if (!flowPath) {
        console.error('Usage: flint replay <flow-file.yaml>');
        process.exit(1);
    }
    replay(path.resolve(flowPath)).catch(console.error);
}
if (require.main === module) {
    runCli();
}
