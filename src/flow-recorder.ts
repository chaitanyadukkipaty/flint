/**
 * flow-recorder.ts
 * Appends timestamped actions (from LLM or user) to a flow YAML file.
 * Each step includes screenshot path and page context summary.
 */
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';

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

export class FlowRecorder {
  private flowPath: string;
  private flow: FlowFile;
  private stepCounter = 0;

  constructor(flowPath: string, flowName: string) {
    this.flowPath = flowPath;
    this.flow = {
      name: flowName,
      source: 'hybrid',
      recorded_at: new Date().toISOString(),
      steps: [],
    };
    this.save();
  }

  append(step: Omit<FlowStep, 'id' | 'timestamp'>): FlowStep {
    this.stepCounter++;
    const full: FlowStep = {
      id: this.stepCounter,
      timestamp: new Date().toISOString(),
      ...step,
    };
    this.flow.steps.push(full);
    this.save();
    return full;
  }

  private save() {
    fs.writeFileSync(this.flowPath, yaml.dump(this.flow, { lineWidth: 120 }), 'utf8');
  }

  getStepCount(): number {
    return this.stepCounter;
  }

  getFlowPath(): string {
    return this.flowPath;
  }
}
