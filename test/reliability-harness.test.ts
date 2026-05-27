import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  formatReliabilityBaselineMarkdown,
  publishReliabilityBaseline,
  runFaultInjectionHarness,
  runSyntheticSoakWorkload,
} from '../src/reliability-harness.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
});

describe('Reliability harness', () => {
  it('runs the fault injection harness scenarios successfully', async () => {
    const report = await runFaultInjectionHarness();
    tempDirs.push(report.rootDir);

    assert.equal(report.scenarios.length, 2);
    assert.ok(report.scenarios.every((scenario) => scenario.passed));
  });

  it('runs a synthetic soak workload and publishes a markdown baseline', async () => {
    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-reliability-baseline-'));
    tempDirs.push(outputRoot);
    const outputPath = path.join(outputRoot, 'reliability-baselines.md');

    const report = await runSyntheticSoakWorkload({ ticketCount: 8 });
    tempDirs.push(report.rootDir);

    assert.equal(report.metrics.totalTickets, 8);
    assert.ok(report.metrics.totalAttempts >= 8);

    const markdown = formatReliabilityBaselineMarkdown(report);
    assert.match(markdown, /Hephaestus Reliability Baselines/);
    assert.match(markdown, /Blocked-retry success ratio/);

    const publishedReport = await publishReliabilityBaseline(outputPath, 8);
    tempDirs.push(publishedReport.rootDir);

    const publishedContent = await fs.readFile(outputPath, 'utf-8');
    assert.match(publishedContent, /Synthetic Soak Workload/);
    assert.match(publishedContent, /Execution failure taxonomy stability/);
  });
});