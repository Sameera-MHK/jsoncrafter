import { JsonCrafterError } from '../utils/errors.js';

// Parses JSON text and checks that the top-level value is an object or array.
export function parseJson(text, source = 'input') {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  if (clean.trim() === '') {
    throw new JsonCrafterError(`${source} is empty.`, {
      code: 'EMPTY_INPUT',
      hint: 'Provide a JSON object or array.',
    });
  }

  let value;
  try {
    value = JSON.parse(clean);
  } catch (err) {
    const where = locate(clean, err.message);
    throw new JsonCrafterError(`Invalid JSON in ${source}${where}: ${err.message}`, {
      code: 'INVALID_JSON',
      hint: 'Check for trailing commas, single quotes, comments, or unquoted keys. JSON allows none of these.',
    });
  }

  if (value === null || typeof value !== 'object') {
    throw new JsonCrafterError(
      `Unsupported top-level value in ${source}: expected an object or array, got ${value === null ? 'null' : typeof value}.`,
      {
        code: 'UNSUPPORTED_TOP_LEVEL',
        hint: 'Wrap the value in an object, for example {"value": 42}.',
      },
    );
  }

  return value;
}

// Turns "... at position 12 ..." into " (line 2, column 3)" when possible.
function locate(text, message) {
  if (/line \d+ column \d+/.test(message)) return '';
  const match = /position (\d+)/.exec(message);
  if (!match) return '';
  const pos = Number(match[1]);
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const column = pos - before.lastIndexOf('\n');
  return ` (line ${line}, column ${column})`;
}
