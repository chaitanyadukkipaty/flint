export type Assistant = 'claude' | 'copilot' | 'both';
export interface FlintConfig {
    assistant: Assistant;
}
export declare function loadConfig(cwd?: string): FlintConfig | null;
//# sourceMappingURL=config.d.ts.map