import * as fs from 'fs';
import * as path from 'path';

export type Assistant = 'claude' | 'copilot' | 'both';

export interface FlintConfig {
  assistant: Assistant;
}

export function loadConfig(cwd: string = process.cwd()): FlintConfig | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, '.flint.json'), 'utf8')) as FlintConfig;
  } catch {
    return null;
  }
}
