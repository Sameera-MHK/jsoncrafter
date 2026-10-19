import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJson } from '../src/core/parse-json.js';

test('parses objects and arrays', () => {
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJson('[1,2]'), [1, 2]);
});

test('strips a UTF-8 BOM', () => {
  assert.deepEqual(parseJson('﻿{"a":1}'), { a: 1 });
});

test('reports invalid JSON with location and a hint', () => {
  assert.throws(() => parseJson('{\n  "a": 1,\n}', 'user.json'), (err) => {
    assert.equal(err.code, 'INVALID_JSON');
    assert.match(err.message, /user\.json/);
    assert.match(err.message, /line 3/);
    assert.match(err.hint, /trailing commas/);
    return true;
  });
});

test('rejects empty input', () => {
  assert.throws(() => parseJson('   '), { code: 'EMPTY_INPUT' });
});

test('rejects top-level primitives', () => {
  for (const text of ['42', '"text"', 'true', 'null']) {
    assert.throws(() => parseJson(text), { code: 'UNSUPPORTED_TOP_LEVEL' });
  }
});
