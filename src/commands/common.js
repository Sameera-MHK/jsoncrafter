import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { JsonCrafterError, UsageError } from '../utils/errors.js';
import { parseJson } from '../core/parse-json.js';
import { fetchJson, isUrl, parseHeaders, DEFAULT_TIMEOUT_MS } from '../core/fetch-json.js';
import { buildModel, toTypeName, validateTypeName } from '../core/infer-types.js';
import { writeOutput } from '../core/write-output.js';
import { generateTypeScript } from '../core/generate-typescript.js';
import { generateZod } from '../core/generate-zod.js';

export const GENERATE_OPTIONS = {
  name: { type: 'string', short: 'n' },
  output: { type: 'string', short: 'o' },
  force: { type: 'boolean', short: 'f', default: false },
  quiet: { type: 'boolean', short: 'q', default: false },
  json: { type: 'boolean', default: false },
  header: { type: 'string', short: 'H', multiple: true, default: [] },
  timeout: { type: 'string' },
  'allow-private-network': { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

export function parseCommandArgs(args, options) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError(err.message.replace(/\. To specify a positional argument.*$/s, '.'), {
      hint: 'Run with --help to see available options.',
    });
  }
}

export function parseInteger(value, flag, { min, max }) {
  const number = Number(value);
  if (!/^\d+$/.test(String(value)) || number < min || number > max) {
    throw new UsageError(`${flag} must be an integer between ${min} and ${max}.`, { code: 'INVALID_OPTION' });
  }
  return number;
}

export const FORMATS = {
  types: {
    suffix: '.types.ts',
    label: 'TypeScript types',
    generate: generateTypeScript,
    importLine: (name, spec) => `import type { ${name} } from "${spec}";`,
  },
  zod: {
    suffix: '.schema.ts',
    label: 'Zod schema',
    generate: generateZod,
    importLine: (name, spec) => `import { ${name}Schema } from "${spec}";`,
  },
};

// Reads JSON from a file, URL, or stdin ("-" or no argument with piped input).
export async function readInput(input, values, stdin) {
  if (input === undefined || input === '-') {
    if (input === undefined && stdin.isTTY) {
      throw new UsageError('Missing input.', { hint: 'Pass a JSON file, a URL, or pipe JSON into stdin.' });
    }
    const chunks = [];
    for await (const chunk of stdin) chunks.push(chunk);
    return { value: parseJson(Buffer.concat(chunks).toString('utf8'), 'stdin'), source: 'stdin', defaultName: 'Root' };
  }

  if (isUrl(input)) {
    const timeoutMs = values.timeout === undefined
      ? DEFAULT_TIMEOUT_MS
      : parseInteger(values.timeout, '--timeout', { min: 1, max: 600_000 });
    const value = await fetchJson(input, {
      headers: parseHeaders(values.header),
      timeoutMs,
      allowPrivateNetwork: values['allow-private-network'],
    });
    const url = new URL(input);
    const segment = url.pathname.split('/').filter(Boolean).pop() || '';
    return { value, source: `${url.origin}${url.pathname}`, defaultName: toTypeName(segment, 'Root') };
  }

  let text;
  try {
    text = await fs.readFile(input, 'utf8');
  } catch (err) {
    const message = err.code === 'ENOENT' ? `File not found: ${input}`
      : err.code === 'EISDIR' ? `Expected a file but got a directory: ${input}`
      : `Could not read ${input}: ${err.message}`;
    throw new JsonCrafterError(message, { code: 'READ_FAILED' });
  }
  const base = path.basename(input).replace(/\.json$/i, '');
  return {
    value: parseJson(text, input),
    source: path.basename(input),
    defaultName: toTypeName(base, 'Root'),
    file: { dir: path.dirname(input), base },
  };
}

// "UserProfile" -> "user-profile"
function fileBase(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

// Shared flow for the types, zod and generate commands.
export async function runGeneration(formats, args, stdin, { outputIsDir = false } = {}) {
  const { values, positionals } = parseCommandArgs(args, GENERATE_OPTIONS);
  if (positionals.length > 1) throw new UsageError('Expected a single input.');
  if (values.name !== undefined) validateTypeName(values.name);

  const input = await readInput(positionals[0], values, stdin);
  const name = values.name ?? input.defaultName;
  const model = buildModel(input.value, name);

  const dir = input.file?.dir ?? '.';
  const base = input.file?.base ?? fileBase(name);
  const outputs = formats.map((format) => {
    const fileName = base + FORMATS[format].suffix;
    let outPath;
    if (values.output === undefined) outPath = path.join(dir, fileName);
    else if (outputIsDir) outPath = path.join(values.output, fileName);
    else outPath = values.output;
    return { format, path: outPath, content: FORMATS[format].generate(model, { source: input.source }) };
  });

  if (!values.force) {
    for (const out of outputs) {
      if (await exists(out.path)) {
        throw new JsonCrafterError(`${out.path} already exists.`, {
          code: 'FILE_EXISTS',
          hint: 'Use --force to overwrite it, or choose another path with --output.',
        });
      }
    }
  }
  for (const out of outputs) await writeOutput(out.path, out.content, { force: values.force });

  return { values, model, outputs };
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

// Specifier as seen from a file in the same directory as the output.
function importSpecifier(file) {
  return `./${path.basename(file).replace(/\.ts$/, '')}`;
}

// Prints what was generated, or a single JSON document with --json.
export function report({ values, model, outputs }, out) {
  const files = outputs.map((o) => ({ path: o.path, format: o.format }));
  if (values.json) {
    out.stdout.write(JSON.stringify({ ok: true, files, warnings: model.warnings }, null, 2) + '\n');
    return;
  }
  if (values.quiet) return;
  for (const w of model.warnings) out.stderr.write(`warning: ${w.path}: ${w.message}\n`);
  for (const o of outputs) {
    const format = FORMATS[o.format];
    out.stdout.write(`Generated ${format.label}: ${o.path}\n`);
    out.stdout.write(`  ${format.importLine(model.rootName, importSpecifier(o.path))}\n`);
  }
}
