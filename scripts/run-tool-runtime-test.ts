import { EngineeringToolRuntime } from '../src/tool-runtime.js';

async function main() {
  const runtime = new EngineeringToolRuntime({ workspaceRoot: '.', dryRun: false });
  console.log('Tool policy snapshot:', runtime.getPolicySnapshot());

  for (const cmd of ['npm', 'npm.cmd']) {
    try {
      console.log(`Running via runtime: ${cmd} test`);
      const result = await runtime.execute({
        tool: 'command.run',
        command: cmd,
        args: ['test'],
        cwd: '.',
        timeoutMs: 120000,
      } as any);
      console.log(`${cmd} result:`, result);
    } catch (err) {
      console.error(`Error running ${cmd}:`, err);
    }
  }
}

main().catch((err) => {
  console.error('Error running test:', err);
  process.exit(1);
});
