/**
 * Public API for flint.
 * Import specific modules if you want to embed the recorder or locator
 * generator into your own tooling.
 */
export { FlowRecorder, FlowStep, FlowFile, Actor, ActionType } from './flow-recorder';
export { generateLocators, formatLocators, LocatorEntry } from './pom-generator';
export { attachManualCapture } from './manual-capture';
export { healStep, HealResult } from './llm-healer';
//# sourceMappingURL=index.d.ts.map