/**
 * cli.ts — single entry point for the `flint` CLI.
 *
 * Usage:
 *   flint init                 Set up skills + .mcp.json in current project
 *   flint session [name]        Start a hybrid recording session
 *   flint replay <flow.yaml>    Replay a recorded flow (with LLM self-healing)
 *   flint pom [url]             Print CSS/XPath locators for a page
 */

const [, , cmd, ...args] = process.argv;

function help() {
  console.log(`
flint <command> [args]

Commands:
  init                  Set up skills + .mcp.json in the current project
  session [name]        Start a hybrid browser session (LLM + manual, recorded)
  session:llm [name]    Same as session but with LLM locator suggestions enabled
  session --llm [name]  Same as above
  replay <flow.yaml>    Replay a flow YAML with LLM self-healing on failure
  pom [url]             Print resilient CSS/XPath locators for a page

Examples:
  flint init
  flint session "checkout flow"
  flint replay flows/checkout-flow.yaml
  flint pom https://example.com
`);
}

switch (cmd) {
  case 'init':
    require('./init');
    break;
  case 'session':
  case 'session:llm': {
    const llmFlag = args.includes('--llm') || cmd === 'session:llm';
    if (llmFlag) process.env.FLINT_LLM = '1';
    const nameArg = args.find(a => !a.startsWith('--'));
    if (nameArg) process.argv[2] = nameArg;
    require('./session');
    break;
  }
  case 'replay': {
    if (!args[0]) { console.error('Usage: flint replay <flow.yaml>'); process.exit(1); }
    process.argv[2] = args[0];
    const { runCli } = require('./flow-player');
    runCli();
    break;
  }
  case 'pom': {
    if (args[0]) process.argv[2] = args[0];
    const { runCli } = require('./pom-generator');
    runCli();
    break;
  }
  default:
    help();
    if (cmd) process.exit(1);
}
