import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchJson, isBlockedAddress, parseHeaders, displayUrl } from '../src/core/fetch-json.js';

async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

const json = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
};
const local = { allowPrivateNetwork: true };

test('fetches and parses JSON', async (t) => {
  const url = await serve(t, (req, res) => json(res, '{"ok":true}'));
  assert.deepEqual(await fetchJson(`${url}/data`, local), { ok: true });
});

test('sends custom headers', async (t) => {
  let seen;
  const url = await serve(t, (req, res) => {
    seen = req.headers.authorization;
    json(res, '{}');
  });
  await fetchJson(url, { ...local, headers: parseHeaders(['Authorization: Bearer secret']) });
  assert.equal(seen, 'Bearer secret');
});

test('reports HTTP errors without leaking the query string', async (t) => {
  const url = await serve(t, (req, res) => json(res, '{}', 500));
  await assert.rejects(fetchJson(`${url}/x?token=secret`, local), (err) => {
    assert.equal(err.code, 'HTTP_ERROR');
    assert.match(err.message, /HTTP 500/);
    assert.doesNotMatch(err.message, /secret/);
    return true;
  });
});

test('rejects non-JSON responses', async (t) => {
  const url = await serve(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html></html>');
  });
  await assert.rejects(fetchJson(url, local), { code: 'NOT_JSON' });
});

test('accepts +json content types', async (t) => {
  const url = await serve(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/problem+json; charset=utf-8' });
    res.end('[1]');
  });
  assert.deepEqual(await fetchJson(url, local), [1]);
});

test('rejects invalid JSON bodies', async (t) => {
  const url = await serve(t, (req, res) => json(res, '{bad'));
  await assert.rejects(fetchJson(url, local), { code: 'INVALID_JSON' });
});

test('enforces the response size limit (with and without content-length)', async (t) => {
  const big = JSON.stringify({ data: 'x'.repeat(2000) });
  const url = await serve(t, (req, res) => {
    if (req.url === '/chunked') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write(big.slice(0, 1000));
      res.end(big.slice(1000));
    } else json(res, big);
  });
  await assert.rejects(fetchJson(url, { ...local, maxBytes: 100 }), { code: 'RESPONSE_TOO_LARGE' });
  await assert.rejects(fetchJson(`${url}/chunked`, { ...local, maxBytes: 100 }), { code: 'RESPONSE_TOO_LARGE' });
});

test('times out slow responses', async (t) => {
  const url = await serve(t, () => {});
  await assert.rejects(fetchJson(url, { ...local, timeoutMs: 100 }), { code: 'TIMEOUT' });
});

test('follows redirects but drops headers on cross-origin redirects', async (t) => {
  let seen = 'unset';
  const target = await serve(t, (req, res) => {
    seen = req.headers.authorization;
    json(res, '{"moved":true}');
  });
  const source = await serve(t, (req, res) => {
    res.writeHead(302, { location: `${target.replace('127.0.0.1', 'localhost')}/final` });
    res.end();
  });
  const result = await fetchJson(source, { ...local, headers: { authorization: 'Bearer secret' } });
  assert.deepEqual(result, { moved: true });
  assert.equal(seen, undefined);
});

test('reports connection failures', async () => {
  await assert.rejects(fetchJson('http://127.0.0.1:1/', local), { code: 'NETWORK_ERROR' });
});

test('rejects unsafe URL schemes and embedded credentials', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com/a.json', 'javascript://x', 'data://x']) {
    await assert.rejects(fetchJson(url), { code: 'UNSAFE_URL' }, url);
  }
  await assert.rejects(fetchJson('https://user:pass@example.com/'), { code: 'UNSAFE_URL' });
});

test('blocks private, loopback, link-local and metadata destinations by default', async (t) => {
  const url = await serve(t, (req, res) => json(res, '{}'));
  const port = new URL(url).port;
  for (const target of [
    url,
    `http://localhost:${port}/`,
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://0.0.0.0/',
  ]) {
    await assert.rejects(fetchJson(target, { timeoutMs: 1000 }), { code: 'BLOCKED_ADDRESS' }, target);
  }
});

test('address classification', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test('header parsing validates names', () => {
  assert.deepEqual(parseHeaders(['X-Api-Key: abc:def']), { 'x-api-key': 'abc:def' });
  assert.throws(() => parseHeaders(['no colon']), { code: 'INVALID_HEADER' });
  assert.throws(() => parseHeaders(['Bad Name: x']), { code: 'INVALID_HEADER' });
});

test('displayUrl hides query strings', () => {
  assert.equal(displayUrl(new URL('https://api.example.com/v1/users?key=secret')), 'https://api.example.com/v1/users');
});
