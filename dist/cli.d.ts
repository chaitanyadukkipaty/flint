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
declare const cmd: string, args: string[];
declare function help(): void;
//# sourceMappingURL=cli.d.ts.map