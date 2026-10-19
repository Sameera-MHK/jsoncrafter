import fs from 'node:fs';
import { JsonForgeError } from './utils/errors.js';
import * as types from './commands/types.js';
import * as zod from './commands/zod.js';
import * as generate from './commands/generate.js';
import * as mock from './commands/mock.js';

const COMMANDS = { types, zod, generate, mock };

export const VERSION = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

const HELP = `Usage: jsonforge <command> [options]

Turn JSON into TypeScript types, Zod schemas, and a local mock REST API.

Commands:
  types <input>       Generate TypeScript types
  zod <input>         Generate Zod schemas
  generate <input>    Generate both
  mock <path>         Serve JSON fixtures as a local REST API

Input can be a JSON file, an http(s) URL, or "-" to read from stdin.

Options:
  -h, --help          Show help (use "jsonforge <command> --help" for details)
  -v, --version       Show version

Examples:
  jsonforge types user.json --name User --output src/types/user.ts
  jsonforge zod user.json
  cat user.json | jsonforge generate - --name User --output src/generated
  jsonforge mock ./fixtures --port 4000
`;

// Returns an exit code. For "mock" it resolves once the server is listening.
export async function run(argv, io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }) {
  const [first, ...rest] = argv;

  if (first === undefined || first === '-h' || first === '--help' || first === 'help') {
    io.stdout.write(HELP);
    return 0;
  }
  if (first === '-v' || first === '--version') {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const command = COMMANDS[first];
  if (!command) {
    io.stderr.write(`error: Unknown command "${first}".\nRun "jsonforge --help" to see available commands.\n`);
    return 2;
  }
  if (rest.includes('-h') || rest.includes('--help')) {
    io.stdout.write(command.help);
    return 0;
  }

  try {
    await command.run(rest, io);
    return 0;
  } catch (err) {
    return reportError(err, rest.includes('--json'), io);
  }
}

function reportError(err, asJson, io) {
  if (!(err instanceof JsonForgeError)) {
    io.stderr.write(`error: Unexpected failure: ${err?.message ?? err}\n`);
    return 1;
  }
  if (asJson) {
    io.stdout.write(
      JSON.stringify({ ok: false, error: { code: err.code, message: err.message, hint: err.hint } }, null, 2) + '\n',
    );
  } else {
    io.stderr.write(`error: ${err.message}\n`);
    if (err.hint) io.stderr.write(`hint: ${err.hint}\n`);
  }
  return err.exitCode;
}
