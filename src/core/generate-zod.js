import { UsageError } from '../utils/errors.js';
import { header, propertyKey } from './generate-typescript.js';

export const SUPPORTED_ZOD_VERSIONS = [4];

// Output targets Zod 4. The version is a parameter so another target (for
// example Zod 3) can be added later without changing callers.
export function generateZod(model, { source, zodVersion = 4 } = {}) {
  if (!SUPPORTED_ZOD_VERSIONS.includes(zodVersion)) {
    throw new UsageError(`Zod version ${zodVersion} is not supported.`, {
      code: 'UNSUPPORTED_ZOD_VERSION',
      hint: `Supported versions: ${SUPPORTED_ZOD_VERSIONS.join(', ')}.`,
    });
  }

  const blocks = [];
  for (const node of model.schemaOrder) {
    const lines = node.properties.map((p) => {
      const key = p.key === '__proto__' ? '["__proto__"]' : propertyKey(p.key);
      return `  ${key}: ${zodExpr(p.type)}${p.optional ? '.optional()' : ''},`;
    });
    blocks.push(declare(node.name, `z.object({\n${lines.join('\n')}\n})`));
  }
  if (model.root.kind !== 'object' || !model.root.name) {
    blocks.push(declare(model.rootName, zodExpr(model.root)));
  }
  return `${header(source)}\n\nimport { z } from "zod";\n\n${blocks.join('\n\n')}\n`;
}

function declare(name, expr) {
  return `export const ${name}Schema = ${expr};\nexport type ${name} = z.infer<typeof ${name}Schema>;`;
}

function zodExpr(node) {
  switch (node.kind) {
    case 'string':
      return 'z.string()';
    case 'number':
      return 'z.number()';
    case 'boolean':
      return 'z.boolean()';
    case 'null':
      return 'z.null()';
    case 'unknown':
      return 'z.unknown()';
    case 'object':
      return node.properties.length === 0 ? 'z.record(z.string(), z.unknown())' : `${node.name}Schema`;
    case 'array':
      return `z.array(${zodExpr(node.items)})`;
    case 'union': {
      const nonNull = node.types.filter((t) => t.kind !== 'null');
      if (nonNull.length === 1) return `${zodExpr(nonNull[0])}.nullable()`;
      return `z.union([${node.types.map(zodExpr).join(', ')}])`;
    }
  }
}
