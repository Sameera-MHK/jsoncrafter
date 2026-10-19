import { runGeneration, report } from './common.js';

export const help = `Usage: jsonforge zod <input> [options]

Generate Zod schemas from JSON.

<input> is a JSON file, an http(s) URL, or "-" for stdin.

Options:
  -n, --name <Name>          Root type name (default: derived from the input)
  -o, --output <file>        Output file (default: <input>.schema.ts)
  -f, --force                Overwrite existing files
  -H, --header <"K: V">      Request header for URL input (repeatable)
      --timeout <ms>         URL request timeout (default: 10000)
      --allow-private-network  Allow URL input from localhost/private networks
  -q, --quiet                Print nothing on success
      --json                 Print a machine-readable result
  -h, --help                 Show this help
`;

export async function run(args, io) {
  report(await runGeneration(['zod'], args, io.stdin), io);
}
