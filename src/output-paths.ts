import path from 'node:path';
import { config } from './config.js';

const DEFAULT_OUTPUT_DIR = 'output';

function resolveOutputDirectorySetting(): string {
  const configured = process.env.HEPHAESTUS_OUTPUT_DIR?.trim();
  if (!configured) {
    return DEFAULT_OUTPUT_DIR;
  }

  return configured;
}

export function resolveProjectOutputRoot(baseDir = config.baseDir): string {
  const outputSetting = resolveOutputDirectorySetting();
  if (path.isAbsolute(outputSetting)) {
    return outputSetting;
  }

  return path.resolve(baseDir, outputSetting);
}

export function resolveProjectOutputPath(segment: string, baseDir = config.baseDir): string {
  return path.join(resolveProjectOutputRoot(baseDir), segment);
}
