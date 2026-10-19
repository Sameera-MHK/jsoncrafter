import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { run } from '../src/cli.js';
import { runCli, tempDir } from './helpers.js';

const USER = '{"id":1,"name":"Ada","address":{"city":"London"}}';

async function withUserFile(t) {
  const dir = await tempDir(t);
  const file = path.join(dir, 'user.json');
  await fs.writeFile(file, USER);
  return { dir, file };
}

test('--help and --version exit with 0', async () => {
  const help = await runCli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage: jsoncrafter <command>/);

  const noArgs = await runCli([]);
  assert.equal(noArgs.code, 0);

  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const version = await runCli(['--version']);
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), pkg.version);

  for (const command of ['types', 'zod', 'generate', 'mock']) {
    const result = await runCli([command, '--help']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, new RegExp(`Usage: jsoncrafter ${command}`));
  }
});

test('usage errors exit with 2', async () => {
  assert.equal((await runCli(['unknown'])).code, 2);
  const bad = await runCli(['types', 'x.json', '--nope']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /Unknown option '--nope'/);
  assert.equal((await runCli(['types', 'x.json', '--name', 'class'])).code, 2);
  assert.equal((await runCli(['mock'])).code, 2);
  assert.equal((await runCli(['mock', '.', '--port', 'abc'])).code, 2);
});

test('types writes <name>.types.ts next to the input by default', async (t) => {
  const { dir, file } = await withUserFile(t);
  const result = await runCli(['types', file]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Generated TypeScript types: .*user\.types\.ts/);
  assert.match(result.stdout, /import type \{ User \} from "\.\/user\.types";/);
  const output = await fs.readFile(path.join(dir, 'user.types.ts'), 'utf8');
  assert.match(output, /export interface User \{/);
  assert.match(output, /export interface Address \{/);
});

test('zod supports --name and --output', async (t) => {
  const { dir, file } = await withUserFile(t);
  const out = path.join(dir, 'src', 'schemas', 'user.schema.ts');
  const result = await runCli(['zod', file, '--name', 'Person', '--output', out]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(await fs.readFile(out, 'utf8'), /export const PersonSchema = z\.object/);
});

test('generate writes both files into the output directory', async (t) => {
  const { dir, file } = await withUserFile(t);
  const result = await runCli(['generate', file, '--output', path.join(dir, 'gen'), '--json']);
  assert.equal(result.code, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.files.map((f) => f.format), ['types', 'zod']);
  await fs.access(path.join(dir, 'gen', 'user.types.ts'));
  await fs.access(path.join(dir, 'gen', 'user.schema.ts'));
});

test('refuses to overwrite files unless --force is given', async (t) => {
  const { dir, file } = await withUserFile(t);
  const target = path.join(dir, 'user.types.ts');
  await fs.writeFile(target, 'keep me');

  const result = await runCli(['types', file]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /already exists/);
  assert.match(result.stderr, /--force/);
  assert.equal(await fs.readFile(target, 'utf8'), 'keep me');

  // generate checks every target before writing anything.
  const gen = await runCli(['generate', file]);
  assert.equal(gen.code, 1);
  await assert.rejects(fs.access(path.join(dir, 'user.schema.ts')));

  const forced = await runCli(['types', file, '--force']);
  assert.equal(forced.code, 0);
  assert.notEqual(await fs.readFile(target, 'utf8'), 'keep me');
});

test('reads JSON from stdin', async (t) => {
  const dir = await tempDir(t);
  const result = await runCli(['types', '-', '--name', 'Item'], { input: '[{"a":1}]', cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  assert.match(await fs.readFile(path.join(dir, 'item.types.ts'), 'utf8'), /export type Item = ItemItem\[\];/);
});

test('invalid JSON and missing files exit with 1 and a readable message', async (t) => {
  const dir = await tempDir(t);
  const invalid = await runCli(['types', '-'], { input: '{"a":', cwd: dir });
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /^error: Invalid JSON in stdin/);
  assert.match(invalid.stderr, /hint:/);
  assert.doesNotMatch(invalid.stderr, /at .*\.js:\d+/, 'no stack trace');

  const primitive = await runCli(['types', '-'], { input: '42', cwd: dir });
  assert.equal(primitive.code, 1);
  assert.match(primitive.stderr, /expected an object or array/);

  const missing = await runCli(['types', path.join(dir, 'missing.json')]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /File not found/);

  const asJson = await runCli(['types', path.join(dir, 'missing.json'), '--json']);
  assert.equal(JSON.parse(asJson.stdout).error.code, 'READ_FAILED');
});

test('--quiet prints nothing and warnings go to stderr', async (t) => {
  const dir = await tempDir(t);
  const quiet = await runCli(['types', '-', '--quiet'], { input: '{"a":[]}', cwd: dir });
  assert.equal(quiet.code, 0);
  assert.equal(quiet.stdout + quiet.stderr, '');

  const loud = await runCli(['zod', '-'], { input: '{"a":[]}', cwd: dir });
  assert.match(loud.stderr, /warning: \$\.a: empty array/);
});

test('URL input is blocked for local addresses unless explicitly allowed', async () => {
  const result = await runCli(['types', 'http://127.0.0.1:9/users', '-H', 'Authorization: Bearer topsecret']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /private or local address/);
  assert.match(result.stderr, /--allow-private-network/);
  assert.doesNotMatch(result.stdout + result.stderr, /topsecret/);
});

test('mock command starts, lists routes and reports port conflicts', async (t) => {
  const dir = await tempDir(t);
  await fs.writeFile(path.join(dir, 'users.json'), '[{"id":1}]');
  const io = () => {
    const stdout = new PassThrough();
    let text = '';
    stdout.on('data', (d) => (text += d));
    return { stdin: new PassThrough(), stdout, stderr: new PassThrough(), get text() { return text; } };
  };

  const first = io();
  assert.equal(await run(['mock', dir, '--port', '0', '--json'], first), 0);
  const info = JSON.parse(first.text);
  assert.deepEqual(info.routes, ['/users']);
  assert.deepEqual(await (await fetch(`${info.url}/users`)).json(), [{ id: 1 }]);

  const port = new URL(info.url).port;
  const conflict = await runCli(['mock', dir, '--port', port]);
  assert.equal(conflict.code, 1);
  assert.match(conflict.stderr, /Port \d+ is already in use/);

  process.emit('SIGINT');
  await assert.rejects(fetch(`${info.url}/users`));
});
