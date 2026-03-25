"use strict";
/**
 * inject.ts — CLI fallback for `flint inject <framework>`
 * Prints the config snippet needed to expose the Chrome CDP port in a test framework.
 * The /inject skill handles auto-detection and editing; this is the manual fallback.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInject = runInject;
const PORT = 9222;
const SNIPPETS = {
    playwright: {
        file: 'playwright.config.ts',
        snippet: `// In playwright.config.ts, add to your project's use block:
use: {
  launchOptions: {
    args: ['--remote-debugging-port=${PORT}'],
  },
},`,
    },
    wdio: {
        file: 'wdio.conf.js',
        snippet: `// In wdio.conf.js, add to your capabilities:
capabilities: [{
  browserName: 'chrome',
  'goog:chromeOptions': {
    args: ['--remote-debugging-port=${PORT}'],
  },
}],`,
    },
    selenium: {
        file: 'your test setup file',
        snippet: `// When creating ChromeOptions (note: NO '--' prefix for selenium-webdriver):
const options = new chrome.Options();
options.addArguments('remote-debugging-port=${PORT}');`,
    },
    nightwatch: {
        file: 'nightwatch.conf.js',
        snippet: `// In nightwatch.conf.js, add to desiredCapabilities:
// (Note: Nightwatch uses 'chromeOptions', not 'goog:chromeOptions')
desiredCapabilities: {
  browserName: 'chrome',
  chromeOptions: {
    args: ['--remote-debugging-port=${PORT}'],
  },
},`,
    },
};
function runInject(framework) {
    const key = framework?.toLowerCase();
    if (!key || !SNIPPETS[key]) {
        console.log(`\nflint inject <framework>  — print CDP config snippet\n`);
        console.log('Supported frameworks:\n');
        for (const [name, { file, snippet }] of Object.entries(SNIPPETS)) {
            console.log(`── ${name}  (${file}) ──────────────────`);
            console.log(snippet);
            console.log('');
        }
        console.log(`After adding the snippet, run your tests then attach flint:`);
        console.log(`  flint session [name] --cdp http://localhost:${PORT}\n`);
        return;
    }
    const { file, snippet } = SNIPPETS[key];
    console.log(`\nAdd the following to ${file}:\n`);
    console.log(snippet);
    console.log(`\nThen run your tests and in a separate terminal:\n  flint session [name] --cdp http://localhost:${PORT}\n`);
}
