import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'jsonforge.js');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

export async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsonforge-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

// Runs the real CLI in a child process.
export function runCli(args, { input, cwd = ROOT } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

// Type-checks (and emits JS for) .ts files in dir, resolving "zod" from this project.
export async function compileTs(dir) {
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  await fs.writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.ts'));
  try {
    await promisify(execFile)(process.execPath, [
      TSC, '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022',
      '--skipLibCheck', '--outDir', path.join(dir, 'out'), ...files.map((f) => path.join(dir, f)),
    ]);
    return { ok: true, output: '' };
  } catch (err) {
    return { ok: false, output: `${err.stdout}${err.stderr}` };
  }
}
