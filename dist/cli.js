"use strict";
/**
 * cli.ts — single entry point for the `flint` CLI.
 *
 * Usage:
 *   flint init                        Set up skills + .mcp.json in current project
 *   flint session [name]              Start a hybrid recording session
 *   flint session [name] --cdp <url>  Attach to an existing browser via CDP
 *   flint replay <flow.yaml>          Replay a recorded flow (with LLM self-healing)
 *   flint pom [url]                   Print CSS/XPath locators for a page
 *   flint inject [framework]          Print CDP config snippet for a test framework
 */
const [, , cmd, ...args] = process.argv;
function help() {
    console.log(`
flint <command> [args]

Commands:
  init                          Set up skills + .mcp.json in the current project
  session [name]                Start a hybrid browser session (LLM + manual, recorded)
  session:llm [name]            Same as session but with LLM locator suggestions enabled
  session [name] --cdp <url>    Attach to an existing browser via its CDP URL
  replay <flow.yaml>            Replay a flow YAML with LLM self-healing on failure
  pom [url]                     Print resilient CSS/XPath locators for a page
  inject [framework]            Print CDP config snippet (playwright|wdio|selenium|nightwatch)

Examples:
  flint init
  flint session "checkout flow"
  flint session "checkout flow" --cdp http://localhost:9222
  flint replay flows/checkout-flow.yaml
  flint pom https://example.com
  flint inject playwright
`);
}
switch (cmd) {
    case 'init':
        require('./init');
        break;
    case 'session':
    case 'session:llm': {
        if (cmd === 'session:llm')
            process.env.FLINT_LLM = '1';
        // Parse --cdp <url> flag
        const cdpIdx = args.indexOf('--cdp');
        if (cdpIdx !== -1 && args[cdpIdx + 1]) {
            process.env.FLINT_CDP_URL = args[cdpIdx + 1];
            args.splice(cdpIdx, 2);
        }
        if (args[0])
            process.argv[2] = args[0];
        require('./session');
        break;
    }
    case 'replay': {
        if (!args[0]) {
            console.error('Usage: flint replay <flow.yaml>');
            process.exit(1);
        }
        process.argv[2] = args[0];
        const { runCli } = require('./flow-player');
        runCli();
        break;
    }
    case 'pom': {
        if (args[0])
            process.argv[2] = args[0];
        const { runCli } = require('./pom-generator');
        runCli();
        break;
    }
    case 'inject':
        require('./inject').runInject(args[0]);
        break;
    default:
        help();
        if (cmd)
            process.exit(1);
}
