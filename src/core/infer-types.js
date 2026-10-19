// Shared inference model used by both the TypeScript and Zod generators.
//
// Node shapes:
//   { kind: 'string' | 'number' | 'boolean' | 'null' | 'unknown' }
//   { kind: 'array', items: Node }
//   { kind: 'object', properties: [{ key, type: Node, optional }], name? }
//   { kind: 'union', types: Node[] }
//
// Arrays are treated as multiple samples: all items are merged into one item
// type. Object keys missing from some samples become optional; conflicting
// value types become unions.

import { UsageError } from '../utils/errors.js';

const KIND_ORDER = ['string', 'number', 'boolean', 'object', 'array', 'unknown', 'null'];

const RESERVED_WORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if',
  'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'as', 'implements', 'interface',
  'let', 'package', 'private', 'protected', 'public', 'static', 'yield', 'any', 'boolean',
  'constructor', 'declare', 'get', 'module', 'require', 'number', 'set', 'string', 'symbol',
  'type', 'from', 'of', 'unknown', 'never', 'object', 'undefined', 'bigint', 'keyof',
  'readonly', 'infer', 'is', 'asserts', 'abstract', 'async', 'await', 'namespace', 'global',
  'satisfies', 'accessor', 'out', 'override',
]);

// Global type names that would be confusing (or broken) if shadowed.
const BUILTIN_TYPES = new Set([
  'Array', 'Boolean', 'Date', 'Error', 'Function', 'Map', 'Number', 'Object', 'Partial',
  'Pick', 'Omit', 'Promise', 'Readonly', 'Record', 'RegExp', 'Required', 'Set', 'String',
  'Symbol', 'WeakMap', 'WeakSet', 'JSON', 'Math', 'Exclude', 'Extract', 'NonNullable',
  'ReturnType', 'Parameters', 'Awaited', 'Uppercase', 'Lowercase', 'Capitalize', 'Uncapitalize',
  'BigInt', 'Iterable', 'Iterator', 'Element', 'Event', 'Node', 'Response', 'Request', 'URL',
  'Headers', 'Blob', 'File', 'Z',
]);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function isValidIdentifier(name) {
  return IDENTIFIER.test(name);
}

// Checks a user-provided type name such as --name User.
export function validateTypeName(name) {
  if (!isValidIdentifier(name) || RESERVED_WORDS.has(name) || BUILTIN_TYPES.has(name)) {
    throw new UsageError(`"${name}" cannot be used as a type name.`, {
      code: 'INVALID_NAME',
      hint: 'Use a PascalCase identifier that is not a reserved word or built-in type, for example --name User.',
    });
  }
  return name;
}

// "first-name" -> "FirstName", "2fa" -> "T2fa", "" -> fallback.
export function toTypeName(raw, fallback = 'Item') {
  const words = String(raw).split(/[^A-Za-z0-9]+/).filter(Boolean);
  let name = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  if (!name) name = fallback;
  if (/^[0-9]/.test(name)) name = `T${name}`;
  if (RESERVED_WORDS.has(name) || BUILTIN_TYPES.has(name)) name = `${name}Type`;
  return name;
}

// Naive, predictable singular form used for array item type names.
export function singularize(name) {
  if (/ies$/.test(name) && name.length > 3) return name.slice(0, -3) + 'y';
  if (/[^s]s$/.test(name) && !/(us|is)$/.test(name) && name.length > 1) return name.slice(0, -1);
  return name;
}

export function infer(value) {
  if (value === null) return { kind: 'null' };
  if (Array.isArray(value)) {
    let items = { kind: 'unknown' };
    for (const item of value) items = merge(items, infer(item));
    return { kind: 'array', items };
  }
  switch (typeof value) {
    case 'string':
      return { kind: 'string' };
    case 'number':
      return { kind: 'number' };
    case 'boolean':
      return { kind: 'boolean' };
    default:
      return {
        kind: 'object',
        properties: Object.keys(value).map((key) => ({
          key,
          type: infer(value[key]),
          optional: false,
        })),
      };
  }
}

// Merges two inferred nodes. 'unknown' (from an empty array) yields to anything.
export function merge(a, b) {
  const byKind = new Map();
  for (const node of [...members(a), ...members(b)]) {
    const existing = byKind.get(node.kind);
    if (!existing) byKind.set(node.kind, node);
    else if (node.kind === 'object') byKind.set('object', mergeObjects(existing, node));
    else if (node.kind === 'array') byKind.set('array', { kind: 'array', items: merge(existing.items, node.items) });
  }
  if (byKind.size > 1) byKind.delete('unknown');

  const types = KIND_ORDER.filter((k) => byKind.has(k)).map((k) => byKind.get(k));
  return types.length === 1 ? types[0] : { kind: 'union', types };
}

function members(node) {
  return node.kind === 'union' ? node.types : [node];
}

function mergeObjects(a, b) {
  const bByKey = new Map(b.properties.map((p) => [p.key, p]));
  const aKeys = new Set(a.properties.map((p) => p.key));
  const properties = a.properties.map((p) => {
    const other = bByKey.get(p.key);
    if (!other) return { ...p, optional: true };
    return { key: p.key, type: merge(p.type, other.type), optional: p.optional || other.optional };
  });
  for (const p of b.properties) {
    if (!aKeys.has(p.key)) properties.push({ ...p, optional: true });
  }
  return { kind: 'object', properties };
}

// Infers the value, assigns unique type names to every non-empty object, and
// collects warnings about structures that can only be typed loosely.
export function buildModel(value, rootName) {
  validateTypeName(rootName);
  const root = infer(value);
  const used = new Set([rootName]);
  const preOrder = [];
  const postOrder = [];
  const warnings = [];

  const unique = (base) => {
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}${i}`;
    used.add(name);
    return name;
  };

  // Objects get named on the way down; array items reuse a singular name.
  const visit = (node, baseName, path, isRoot) => {
    if (node.kind === 'object') {
      if (node.properties.length === 0) {
        warnings.push({ path, message: 'empty object; typed as a record of unknown values' });
        return;
      }
      node.name = isRoot ? rootName : unique(baseName);
      preOrder.push(node);
      for (const p of node.properties) {
        visit(p.type, toTypeName(p.key), `${path}.${p.key}`, false);
      }
      postOrder.push(node);
    } else if (node.kind === 'array') {
      if (node.items.kind === 'unknown') {
        warnings.push({ path, message: 'empty array; item type is unknown' });
        return;
      }
      let itemName = singularize(baseName);
      if (itemName === baseName) itemName = `${baseName}Item`;
      visit(node.items, itemName, `${path}[]`, false);
    } else if (node.kind === 'null') {
      warnings.push({ path, message: 'only null values seen; the real type is unknown' });
    } else if (node.kind === 'union') {
      for (const t of node.types) if (t.kind !== 'null') visit(t, baseName, path, false);
    }
  };

  visit(root, rootName, '$', true);
  return { root, rootName, declarations: preOrder, schemaOrder: postOrder, warnings };
}
