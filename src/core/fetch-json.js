import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { JsonForgeError, UsageError } from '../utils/errors.js';
import { parseJson } from './parse-json.js';

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

// Loopback, private, link-local (includes 169.254.169.254 cloud metadata),
// carrier-grade NAT, multicast and reserved ranges. IPv4-mapped IPv6 addresses
// (::ffff:127.0.0.1) are matched against the IPv4 rules by BlockList itself.
const blockList = new net.BlockList();
for (const [prefix, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) {
  blockList.addSubnet(prefix, bits, 'ipv4');
}
for (const [prefix, bits] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) {
  blockList.addSubnet(prefix, bits, 'ipv6');
}

export function isBlockedAddress(address) {
  return blockList.check(address, net.isIPv4(address) ? 'ipv4' : 'ipv6');
}

export function isUrl(input) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
}

// Origin and path only, so query-string tokens never end up in logs.
export function displayUrl(url) {
  return `${url.origin}${url.pathname}`;
}

// ["Authorization: Bearer x"] -> { authorization: "Bearer x" }
export function parseHeaders(list = []) {
  const headers = {};
  for (const entry of list) {
    const index = entry.indexOf(':');
    const name = index > 0 ? entry.slice(0, index).trim() : '';
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
      throw new UsageError('Invalid --header value. Expected "Name: value".', { code: 'INVALID_HEADER' });
    }
    headers[name.toLowerCase()] = entry.slice(index + 1).trim();
  }
  return headers;
}

export async function fetchJson(input, options = {}) {
  const {
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    allowPrivateNetwork = false,
  } = options;

  let url = toUrl(input);
  let sendHeaders = headers;

  for (let redirects = 0; ; redirects++) {
    checkUrl(url, allowPrivateNetwork);
    const res = await request(url, { headers: sendHeaders, timeoutMs, maxBytes, allowPrivateNetwork });

    if (res.status >= 300 && res.status < 400 && res.location) {
      if (redirects >= MAX_REDIRECTS) {
        throw new JsonForgeError(`Too many redirects from ${displayUrl(url)}.`, { code: 'TOO_MANY_REDIRECTS' });
      }
      const next = toUrl(res.location, url);
      // Never forward credentials to a different origin.
      if (next.origin !== url.origin) sendHeaders = {};
      url = next;
      continue;
    }

    if (res.status < 200 || res.status >= 300) {
      throw new JsonForgeError(`Request to ${displayUrl(url)} failed with HTTP ${res.status}.`, {
        code: 'HTTP_ERROR',
        hint: res.status === 401 || res.status === 403 ? 'Pass credentials with --header "Authorization: ..."' : undefined,
      });
    }

    const type = String(res.contentType || '');
    if (!/^application\/([a-z0-9.+-]*\+)?json\b/i.test(type)) {
      throw new JsonForgeError(
        `Response from ${displayUrl(url)} is not JSON (content-type: ${type || 'none'}).`,
        { code: 'NOT_JSON', hint: 'Only application/json responses are accepted.' },
      );
    }

    return parseJson(res.body, displayUrl(url));
  }
}

function toUrl(input, base) {
  try {
    return new URL(input, base);
  } catch {
    throw new UsageError('Invalid URL.', { code: 'INVALID_URL' });
  }
}

function checkUrl(url, allowPrivateNetwork) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError(`Unsupported URL scheme "${url.protocol}". Only http and https are allowed.`, {
      code: 'UNSAFE_URL',
    });
  }
  if (url.username || url.password) {
    throw new UsageError('Credentials inside the URL are not supported.', {
      code: 'UNSAFE_URL',
      hint: 'Use --header "Authorization: ..." instead.',
    });
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivateNetwork && net.isIP(host) && isBlockedAddress(host)) {
    throw blockedError(host);
  }
}

function blockedError(host) {
  return new JsonForgeError(`Refusing to fetch from private or local address (${host}).`, {
    code: 'BLOCKED_ADDRESS',
    hint: 'Use --allow-private-network to fetch from localhost or your local network.',
  });
}

// Validates every resolved address before connecting, so DNS cannot point a
// public-looking hostname at a private address.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const list = Array.isArray(address) ? address : [{ address }];
    if (list.some((entry) => isBlockedAddress(entry.address))) return callback(blockedError(hostname));
    callback(null, address, family);
  });
}

function request(url, { headers, timeoutMs, maxBytes, allowPrivateNetwork }) {
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(url, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'jsonforge-cli', ...headers },
      lookup: allowPrivateNetwork ? undefined : safeLookup,
    });

    // Settles the promise once and tears the request down.
    const fail = (err) => {
      clearTimeout(timer);
      reject(err instanceof JsonForgeError ? err : networkError(err, url));
      req.destroy();
    };
    const timer = setTimeout(() => {
      fail(new JsonForgeError(`Request to ${displayUrl(url)} timed out after ${timeoutMs} ms.`, { code: 'TIMEOUT' }));
    }, timeoutMs);

    req.on('error', fail);

    req.on('response', (res) => {
      const base = {
        status: res.statusCode,
        location: res.headers.location,
        contentType: res.headers['content-type'],
      };
      if (base.status >= 300 && base.status < 400) {
        clearTimeout(timer);
        res.resume();
        return resolve(base);
      }

      const tooLarge = () =>
        new JsonForgeError(`Response from ${displayUrl(url)} exceeds the ${maxBytes} byte limit.`, {
          code: 'RESPONSE_TOO_LARGE',
        });
      if (Number(res.headers['content-length']) > maxBytes) return fail(tooLarge());

      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) return fail(tooLarge());
        chunks.push(chunk);
      });
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ ...base, body: Buffer.concat(chunks).toString('utf8') });
      });
      res.on('error', fail);
    });

    req.end();
  });
}

function networkError(err, url) {
  const where = displayUrl(url);
  const messages = {
    ENOTFOUND: `Could not resolve host for ${where}.`,
    ECONNREFUSED: `Connection refused by ${where}.`,
    ECONNRESET: `Connection reset by ${where}.`,
  };
  return new JsonForgeError(messages[err.code] || `Request to ${where} failed: ${err.message}`, {
    code: 'NETWORK_ERROR',
  });
}
