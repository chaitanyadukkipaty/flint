/**
 * manual-capture.ts
 * Injects CDP event listeners into a live headed browser to capture
 * user actions (clicks, keyboard input, navigations) in real-time.
 * Emits structured events to the FlowRecorder.
 */
import { Page } from 'playwright';
import { FlowRecorder } from './flow-recorder';
export declare function attachManualCapture(page: Page, recorder: FlowRecorder, screenshotDir: string, useLLM?: boolean): Promise<() => void>;
//# sourceMappingURL=manual-capture.d.ts.map