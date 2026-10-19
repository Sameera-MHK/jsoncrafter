import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JsonCrafterError } from '../utils/errors.js';
import { parseJson } from '../core/parse-json.js';

// Reads every .json fixture once at startup. Requests are only matched
// against this in-memory map, so request paths never touch the filesystem.
//
//   users.json          -> /users
//   api/posts.json      -> /api/posts
//   index.json          -> /
//   api/index.json      -> /api
export async function loadRoutes(target) {
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    throw new JsonCrafterError(`Fixture path not found: ${target}`, {
      code: 'FIXTURES_NOT_FOUND',
      hint: 'Pass a .json file or a directory that contains .json files.',
    });
  }

  const files = [];
  if (stat.isFile()) {
    if (!target.endsWith('.json')) {
      throw new JsonCrafterError(`Fixture file must end in .json: ${target}`, { code: 'INVALID_FIXTURE' });
    }
    files.push({ file: target, rel: path.basename(target) });
  } else if (stat.isDirectory()) {
    await walk(target, '', files);
  } else {
    throw new JsonCrafterError(`Fixture path is not a regular file or directory: ${target}`, {
      code: 'INVALID_FIXTURE',
    });
  }

  if (files.length === 0) {
    throw new JsonCrafterError(`No .json fixtures found in ${target}`, { code: 'NO_FIXTURES' });
  }

  const routes = new Map();
  for (const { file, rel } of files) {
    const route = toRoute(rel);
    if (routes.has(route)) {
      throw new JsonCrafterError(`Both ${routes.get(route).file} and ${file} map to ${route}.`, {
        code: 'DUPLICATE_ROUTE',
      });
    }
    const text = await fs.readFile(file, 'utf8');
    routes.set(route, { file, body: JSON.stringify(parseJson(text, file)) });
  }
  return new Map([...routes].sort(([a], [b]) => a.localeCompare(b)));
}

// Symbolic links are skipped so fixtures cannot point outside the directory.
async function walk(dir, prefix, files) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel, files);
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push({ file: path.join(dir, entry.name), rel });
  }
}

function toRoute(rel) {
  const route = '/' + rel.replace(/\.json$/, '').replace(/(^|\/)index$/, '');
  return route.length > 1 ? route.replace(/\/$/, '') : '/';
}

function normalizePath(rawUrl) {
  const pathname = rawUrl.split('?')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  return decoded.length > 1 ? decoded.replace(/\/+$/, '') : decoded;
}

export function createMockServer(routes, { delay = 0 } = {}) {
  return http.createServer((req, res) => {
    const send = (status, body, extra = {}) => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        ...extra,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };

    setTimeout(() => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(405, JSON.stringify({ error: 'Method not allowed', method: req.method }), {
          allow: 'GET, HEAD',
        });
      }

      const url = new URL(req.url, 'http://localhost');
      const forced = url.searchParams.get('_status');
      if (forced !== null) {
        const status = Number(forced);
        if (Number.isInteger(status) && status >= 400 && status <= 599) {
          return send(status, JSON.stringify({ error: http.STATUS_CODES[status] || 'Error', status }));
        }
        return send(400, JSON.stringify({ error: '_status must be an integer between 400 and 599' }));
      }

      const pathname = normalizePath(req.url);
      const route = pathname === null ? undefined : routes.get(pathname);
      if (route) return send(200, route.body);

      if (pathname === '/') {
        return send(200, JSON.stringify({ routes: [...routes.keys()] }));
      }
      send(404, JSON.stringify({ error: 'Not found', path: pathname ?? req.url }));
    }, delay);
  });
}

export function listen(server, { port, host }) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new JsonCrafterError(`Port ${port} is already in use on ${host}.`, {
            code: 'PORT_IN_USE',
            hint: 'Stop the other process or choose another port with --port.',
          }),
        );
      } else if (err.code === 'EACCES') {
        reject(new JsonCrafterError(`Permission denied to listen on port ${port}.`, { code: 'PORT_DENIED' }));
      } else {
        reject(new JsonCrafterError(`Could not start server: ${err.message}`, { code: 'LISTEN_FAILED' }));
      }
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(server.address());
    });
  });
}
