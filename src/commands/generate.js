import { runGeneration, report } from './common.js';

export const help = `Usage: jsonforge generate <input> [options]

Generate both TypeScript types and Zod schemas from JSON.

<input> is a JSON file, an http(s) URL, or "-" for stdin.

Options:
  -n, --name <Name>          Root type name (default: derived from the input)
  -o, --output <dir>         Output directory for <base>.types.ts and <base>.schema.ts
                             (default: next to the input file, or the current directory)
  -f, --force                Overwrite existing files
  -H, --header <"K: V">      Request header for URL input (repeatable)
      --timeout <ms>         URL request timeout (default: 10000)
      --allow-private-network  Allow URL input from localhost/private networks
  -q, --quiet                Print nothing on success
      --json                 Print a machine-readable result
  -h, --help                 Show this help
`;

export async function run(args, io) {
  report(await runGeneration(['types', 'zod'], args, io.stdin, { outputIsDir: true }), io);
}
