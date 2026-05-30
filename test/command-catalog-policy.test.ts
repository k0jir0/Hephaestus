import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCommandCatalogAllowlistEntries,
  buildCommandCatalogPolicySnapshot,
  resolveCommandCatalogEntryForPlatform,
} from '../src/domain/policy/command-catalog-policy.js';

describe('command catalog policy', () => {
  it('resolves command IDs to platform-specific argv mappings', () => {
    assert.deepEqual(resolveCommandCatalogEntryForPlatform('npm.run.lint', 'posix'), {
      command: 'npm',
      args: ['run', 'lint'],
    });
    assert.deepEqual(resolveCommandCatalogEntryForPlatform('npm.run.lint', 'win32'), {
      command: 'npm.cmd',
      args: ['run', 'lint'],
    });
  });

  it('publishes catalog entries into the policy snapshot shape', () => {
    const snapshot = buildCommandCatalogPolicySnapshot();
    const lintEntry = snapshot.find((entry) => entry.id === 'npm.run.lint');

    assert.equal(lintEntry?.purpose, 'Run static lint checks.');
    assert.equal(lintEntry?.platforms.posix.command, 'npm');
    assert.equal(lintEntry?.platforms.win32.command, 'npm.cmd');
  });

  it('generates default npm allowlist entries from the catalog', () => {
    const allowlist = buildCommandCatalogAllowlistEntries();

    assert.ok(allowlist.some((entry) => entry.command === 'npm' && entry.args.join(' ') === 'run models:report'));
    assert.ok(allowlist.some((entry) => entry.command === 'npm' && entry.args.join(' ') === 'run tickets -- review-wave'));
    assert.ok(allowlist.some((entry) => entry.command === 'npm' && entry.args.join(' ') === 'run metrics:upgrade-telemetry'));
  });
});
