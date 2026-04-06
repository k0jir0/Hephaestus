import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const testRoot = resolve(repoRoot, "test");

async function findTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        return findTestFiles(fullPath);
      }
      return entry.name.endsWith(".test.ts") ? [fullPath] : [];
    }),
  );

  return files.flat().sort();
}

const testFiles = await findTestFiles(testRoot);

if (testFiles.length === 0) {
  console.error(`No test files found under ${testRoot}`);
  process.exit(1);
}

const tsxCliPath = require.resolve("tsx/cli");
const child = spawn(
  process.execPath,
  [tsxCliPath, "--test", "--test-concurrency=1", ...testFiles],
  {
    cwd: repoRoot,
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
