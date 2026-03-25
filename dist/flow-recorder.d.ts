export type Actor = 'llm' | 'user';
export type ActionType = 'navigate' | 'click' | 'type' | 'scroll' | 'select' | 'keypress' | 'hover';
export interface FlowStep {
    id: number;
    actor: Actor;
    action: ActionType;
    timestamp: string;
    description?: string;
    url?: string;
    element?: {
        name: string;
        css: string;
        xpath: string;
        resilience?: number;
    };
    value?: string;
    key?: string;
    context?: {
        title?: string;
        screenshot?: string;
        elements_summary?: string;
    };
}
export interface FlowFile {
    name: string;
    source: 'hybrid';
    recorded_at: string;
    steps: FlowStep[];
}
export declare class FlowRecorder {
    private flowPath;
    private flow;
    private stepCounter;
    constructor(flowPath: string, flowName: string);
    append(step: Omit<FlowStep, 'id' | 'timestamp'>): FlowStep;
    private save;
    getStepCount(): number;
    getFlowPath(): string;
}
//# sourceMappingURL=flow-recorder.d.ts.map