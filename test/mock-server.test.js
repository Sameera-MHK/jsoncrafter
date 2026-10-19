import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { loadRoutes, createMockServer, listen } from '../src/mock/server.js';
import { tempDir } from './helpers.js';

async function fixtures(t) {
  const dir = await tempDir(t);
  await fs.mkdir(path.join(dir, 'fixtures', 'api'), { recursive: true });
  await fs.writeFile(path.join(dir, 'fixtures', 'users.json'), '[{"id":1}]');
  await fs.writeFile(path.join(dir, 'fixtures', 'api', 'posts.json'), '{"posts":[]}');
  await fs.writeFile(path.join(dir, 'fixtures', 'api', 'index.json'), '{"api":true}');
  await fs.writeFile(path.join(dir, 'fixtures', 'notes.txt'), 'ignored');
  await fs.writeFile(path.join(dir, 'secret.json'), '{"secret":true}');
  return dir;
}

async function start(t, target, options) {
  const server = createMockServer(await loadRoutes(target), options);
  const { port } = await listen(server, { port: 0, host: '127.0.0.1' });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${port}`;
}

// Sends a raw request so the path is not normalized by the client.
function rawGet(base, rawPath) {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${rawPath} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.on('data', (d) => (data += d));
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

test('maps fixture files to routes', async (t) => {
  const dir = await fixtures(t);
  const routes = await loadRoutes(path.join(dir, 'fixtures'));
  assert.deepEqual([...routes.keys()], ['/api', '/api/posts', '/users']);
});

test('serves a directory of fixtures', async (t) => {
  const base = await start(t, path.join(path.join(await fixtures(t)), 'fixtures'));
  let res = await fetch(`${base}/users`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await res.json(), [{ id: 1 }]);

  assert.deepEqual(await (await fetch(`${base}/api/posts/?page=2`)).json(), { posts: [] });
  assert.deepEqual(await (await fetch(`${base}/api`)).json(), { api: true });
  assert.deepEqual(await (await fetch(`${base}/`)).json(), { routes: ['/api', '/api/posts', '/users'] });

  res = await fetch(`${base}/missing`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'Not found');
});

test('serves a single fixture file', async (t) => {
  const dir = await fixtures(t);
  const base = await start(t, path.join(dir, 'fixtures', 'users.json'));
  assert.equal((await fetch(`${base}/users`)).status, 200);
});

test('only allows GET and HEAD', async (t) => {
  const base = await start(t, path.join(await fixtures(t), 'fixtures'));
  const res = await fetch(`${base}/users`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, HEAD');
  const head = await fetch(`${base}/users`, { method: 'HEAD' });
  assert.equal(head.status, 200);
});

test('supports forced error statuses and delays', async (t) => {
  const base = await start(t, path.join(await fixtures(t), 'fixtures'), { delay: 150 });
  const started = Date.now();
  const res = await fetch(`${base}/users?_status=503`);
  assert.ok(Date.now() - started >= 140);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'Service Unavailable', status: 503 });
  assert.equal((await fetch(`${base}/users?_status=200`)).status, 400);
});

test('path traversal attempts never read files outside the fixtures', async (t) => {
  const dir = await fixtures(t);
  const base = await start(t, path.join(dir, 'fixtures'));
  for (const raw of ['/../secret', '/..%2fsecret', '/%2e%2e/secret', '/api/../../secret', '/%E0%A4%A', '//etc/passwd']) {
    const response = await rawGet(base, raw);
    assert.doesNotMatch(response, /"secret":true/, raw);
    assert.match(response, /^HTTP\/1\.1 (400|404)/, raw);
  }
});

test('skips symbolic links inside the fixtures directory', { skip: process.platform === 'win32' && 'symlinks need extra privileges on Windows' }, async (t) => {
  const dir = await fixtures(t);
  await fs.symlink(path.join(dir, 'secret.json'), path.join(dir, 'fixtures', 'link.json'));
  const routes = await loadRoutes(path.join(dir, 'fixtures'));
  assert.equal(routes.has('/link'), false);
});

test('reports missing paths, empty directories and invalid fixtures', async (t) => {
  const dir = await tempDir(t);
  await assert.rejects(loadRoutes(path.join(dir, 'nope')), { code: 'FIXTURES_NOT_FOUND' });
  await assert.rejects(loadRoutes(dir), { code: 'NO_FIXTURES' });
  await fs.writeFile(path.join(dir, 'bad.json'), '{oops');
  await assert.rejects(loadRoutes(dir), { code: 'INVALID_JSON' });
  await fs.writeFile(path.join(dir, 'x.txt'), '{}');
  await assert.rejects(loadRoutes(path.join(dir, 'x.txt')), { code: 'INVALID_FIXTURE' });
});

test('detects routes that map to the same path', async (t) => {
  const dir = await tempDir(t);
  await fs.mkdir(path.join(dir, 'users'));
  await fs.writeFile(path.join(dir, 'users.json'), '[]');
  await fs.writeFile(path.join(dir, 'users', 'index.json'), '[]');
  await assert.rejects(loadRoutes(dir), { code: 'DUPLICATE_ROUTE' });
});

test('reports port conflicts as a readable error', async (t) => {
  const dir = await fixtures(t);
  const base = await start(t, path.join(dir, 'fixtures'));
  const second = createMockServer(new Map());
  await assert.rejects(listen(second, { port: Number(new URL(base).port), host: '127.0.0.1' }), {
    code: 'PORT_IN_USE',
  });
});
