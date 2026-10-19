import { UsageError } from '../utils/errors.js';
import { parseCommandArgs, parseInteger } from './common.js';
import { loadRoutes, createMockServer, listen } from '../mock/server.js';

export const help = `Usage: jsonforge mock <file-or-directory> [options]

Serve JSON fixtures as a local read-only REST API.

Routes:
  users.json           -> GET /users
  api/posts.json       -> GET /api/posts
  index.json           -> GET /
  Add ?_status=500 to any URL to get an error response with that status.

Options:
  -p, --port <port>          Port to listen on (default: 4000, 0 = random)
      --host <host>          Host to bind (default: 127.0.0.1)
      --delay <ms>           Delay every response (default: 0)
  -q, --quiet                Do not print the route list
      --json                 Print startup information as JSON
  -h, --help                 Show this help
`;

const OPTIONS = {
  port: { type: 'string', short: 'p' },
  host: { type: 'string', default: '127.0.0.1' },
  delay: { type: 'string' },
  quiet: { type: 'boolean', short: 'q', default: false },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export async function run(args, io) {
  const { values, positionals } = parseCommandArgs(args, OPTIONS);
  if (positionals.length !== 1) {
    throw new UsageError('Expected one fixture file or directory.', { hint: 'Example: jsonforge mock ./fixtures' });
  }
  const port = values.port === undefined ? 4000 : parseInteger(values.port, '--port', { min: 0, max: 65535 });
  const delay = values.delay === undefined ? 0 : parseInteger(values.delay, '--delay', { min: 0, max: 60_000 });

  const routes = await loadRoutes(positionals[0]);
  const server = createMockServer(routes, { delay });
  const address = await listen(server, { port, host: values.host });

  const shownHost = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  const baseUrl = `http://${shownHost}:${address.port}`;

  if (values.json) {
    io.stdout.write(JSON.stringify({ ok: true, url: baseUrl, routes: [...routes.keys()] }) + '\n');
  } else if (!values.quiet) {
    io.stdout.write(`Mock server running at ${baseUrl}\n\n`);
    for (const [route, { file }] of routes) io.stdout.write(`  GET ${baseUrl}${route}  <- ${file}\n`);
    io.stdout.write('\nPress Ctrl+C to stop.\n');
  }
  if (!LOOPBACK.has(values.host)) {
    io.stderr.write(`warning: listening on ${values.host}; the fixtures are reachable from other machines.\n`);
  }

  const shutdown = () => {
    server.close();
    server.closeAllConnections();
    if (!values.quiet && !values.json) io.stdout.write('\nMock server stopped.\n');
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}
