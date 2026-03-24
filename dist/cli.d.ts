/**
 * cli.ts — single entry point for the `flint` CLI.
 *
 * Usage:
 *   flint init                 Set up skills + .mcp.json in current project
 *   flint session [name]        Start a hybrid recording session
 *   flint replay <flow.yaml>    Replay a recorded flow (with LLM self-healing)
 *   flint pom [url]             Print CSS/XPath locators for a page
 */
declare const cmd: string, args: string[];
declare function help(): void;
//# sourceMappingURL=cli.d.ts.map