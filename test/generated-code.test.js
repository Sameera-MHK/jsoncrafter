import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildModel } from '../src/core/infer-types.js';
import { generateTypeScript } from '../src/core/generate-typescript.js';
import { generateZod } from '../src/core/generate-zod.js';
import { tempDir, compileTs } from './helpers.js';

const SAMPLES = {
  user: {
    id: 1,
    name: 'Ada',
    tags: ['a'],
    address: { city: 'London', zip: null },
    meta: {},
    empty: [],
    'first-name': 'x',
    class: 'reserved',
    __proto__: null,
  },
  users: [{ id: 1, role: 'admin' }, { id: '2', nickname: 'x', role: null }],
  matrix: { grid: [[1, 2], [3]], mixed: [1, 'a', true, null, { k: 1 }, [2]] },
  emptyRoot: {},
  emptyList: [],
};

test('generated TypeScript and Zod code compiles with tsc --strict', async (t) => {
  const dir = await tempDir(t);
  for (const [key, value] of Object.entries(SAMPLES)) {
    const model = buildModel(value, 'Root');
    await fs.writeFile(path.join(dir, `${key}.types.ts`), generateTypeScript(model, { source: `${key}.json` }));
    await fs.writeFile(path.join(dir, `${key}.schema.ts`), generateZod(model, { source: `${key}.json` }));
  }
  // The Zod-inferred type must be assignable to the generated interface and back.
  await fs.writeFile(
    path.join(dir, 'check.ts'),
    `import type { Root as T } from "./user.types.js";
import type { Root as Z } from "./user.schema.js";
const a: T = {} as Z;
const b: Z = {} as T;
export { a, b };
`,
  );
  const result = await compileTs(dir);
  assert.ok(result.ok, result.output);

  const users = await import(pathToFileURL(path.join(dir, 'out', 'users.schema.js')));
  assert.equal(users.RootSchema.safeParse([{ id: 1, role: 'x' }, { id: '2', role: null }]).success, true);
  assert.equal(users.RootSchema.safeParse([{ id: true, role: 'x' }]).success, false);
  assert.equal(users.RootSchema.safeParse([{ id: 1 }]).success, false, 'role is required');
  assert.equal(users.RootSchema.safeParse({}).success, false);

  const user = await import(pathToFileURL(path.join(dir, 'out', 'user.schema.js')));
  assert.equal(user.RootSchema.safeParse(SAMPLES.user).success, true);
  assert.equal(user.RootSchema.safeParse({ ...SAMPLES.user, address: { city: 1, zip: null } }).success, false);
  assert.equal(user.RootSchema.safeParse({ ...SAMPLES.user, tags: 'a' }).success, false);

  const matrix = await import(pathToFileURL(path.join(dir, 'out', 'matrix.schema.js')));
  assert.equal(matrix.RootSchema.safeParse(SAMPLES.matrix).success, true);
  assert.equal(matrix.RootSchema.safeParse({ grid: [['x']], mixed: [] }).success, false);
});
