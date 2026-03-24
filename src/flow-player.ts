/**
 * flow-player.ts
 * Replays a flow YAML file step by step using Playwright.
 * On step failure, asks the LLM for an alternative locator (healing),
 * retries the step, and saves the corrected locator back to the YAML.
 *
 * Usage: ts-node src/flow-player.ts flows/my-flow.yaml
 */
import { Page } from 'playwright';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { FlowFile, FlowStep } from './flow-recorder';
import { healStep } from './llm-healer';
import { stealthChromium, stealthArgs, stealthContextOptions, applyStealthToContext } from './stealth';

async function replay(flowPath: string) {
  if (!fs.existsSync(flowPath)) {
    console.error(`Flow file not found: ${flowPath}`);
    process.exit(1);
  }

  const flow = yaml.load(fs.readFileSync(flowPath, 'utf8')) as FlowFile;

  // Deduplicate consecutive same-URL navigate steps (artifact of redirect chains)
  const steps = flow.steps.filter((step, i, arr) => {
    if (step.action !== 'navigate') return true;
    const prev = arr[i - 1];
    return !(prev?.action === 'navigate' && prev.url === step.url);
  });

  console.log(`\nReplaying: ${flow.name} (${steps.length} steps, ${flow.steps.length - steps.length} duplicates skipped)\n`);

  const browser = await stealthChromium.launch({ headless: false, slowMo: 300, channel: 'chrome', args: stealthArgs() })
    .catch(() => stealthChromium.launch({ headless: false, slowMo: 300, args: stealthArgs() }));
  const context = await browser.newContext(stealthContextOptions);
  await applyStealthToContext(context);
  const page = await context.newPage();

  let flowMutated = false;

  for (const step of steps) {
    console.log(`  Step ${step.id} [${step.actor}] ${step.action}${step.url ? ' → ' + step.url : ''}`);
    try {
      await executeStep(page, step);
      await page.waitForTimeout(300);
    } catch (err: any) {
      console.error(`  ✗ Step ${step.id} failed: ${err.message}`);
      console.error(`    CSS: ${step.element?.css}`);

      // Attempt LLM healing
      if (step.element) {
        console.log('  🔧 Asking LLM for alternative locator...');
        const healed = await healStep(page, step, err.message);
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
          } catch (retryErr: any) {
            console.error(`  ✗ Healed locator also failed: ${retryErr.message}`);
          }
        } else {
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
    const updatedFlow: FlowFile = { ...flow, steps: updatedSteps };
    fs.writeFileSync(flowPath, yaml.dump(updatedFlow, { lineWidth: 120 }), 'utf8');
    console.log(`\n✅ Flow updated with healed locators: ${flowPath}\n`);
  }

  console.log('\nReplay complete. Press Ctrl+C to close.\n');
  await page.waitForTimeout(60_000).catch(() => {});
  await browser.close();
}

async function executeStep(page: Page, step: FlowStep) {
  switch (step.action) {
    case 'navigate':
      await page.goto(step.url!, { waitUntil: 'domcontentloaded' });
      break;

    case 'click': {
      const loc = page.locator(step.element!.css);
      await loc.waitFor({ state: 'visible', timeout: 10_000 });
      await loc.click();
      break;
    }

    case 'type': {
      const loc = page.locator(step.element!.css);
      await loc.waitFor({ state: 'visible', timeout: 10_000 });
      await loc.fill(step.value ?? '');
      break;
    }

    case 'select': {
      const loc = page.locator(step.element!.css);
      await loc.selectOption(step.value ?? '');
      break;
    }

    case 'keypress':
      await page.keyboard.press(step.key ?? 'Enter');
      break;

    case 'scroll':
      await page.evaluate(() => (window as Window).scrollBy(0, 400));
      break;

    case 'hover': {
      const loc = page.locator(step.element!.css);
      await loc.hover();
      break;
    }

    default:
      console.warn(`  Unknown action: ${step.action}`);
  }
}

export function runCli() {
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
