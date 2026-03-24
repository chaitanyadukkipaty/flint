"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowRecorder = void 0;
/**
 * flow-recorder.ts
 * Appends timestamped actions (from LLM or user) to a flow YAML file.
 * Each step includes screenshot path and page context summary.
 */
const fs = __importStar(require("fs"));
const yaml = __importStar(require("js-yaml"));
class FlowRecorder {
    flowPath;
    flow;
    stepCounter = 0;
    constructor(flowPath, flowName) {
        this.flowPath = flowPath;
        this.flow = {
            name: flowName,
            source: 'hybrid',
            recorded_at: new Date().toISOString(),
            steps: [],
        };
        this.save();
    }
    append(step) {
        this.stepCounter++;
        const full = {
            id: this.stepCounter,
            timestamp: new Date().toISOString(),
            ...step,
        };
        this.flow.steps.push(full);
        this.save();
        return full;
    }
    save() {
        fs.writeFileSync(this.flowPath, yaml.dump(this.flow, { lineWidth: 120 }), 'utf8');
    }
    getStepCount() {
        return this.stepCounter;
    }
    getFlowPath() {
        return this.flowPath;
    }
}
exports.FlowRecorder = FlowRecorder;
