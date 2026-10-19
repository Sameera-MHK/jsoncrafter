import fs from 'node:fs/promises';
import path from 'node:path';
import { JsonCrafterError } from '../utils/errors.js';

// Writes a file, refusing to replace an existing one unless force is set.
export async function writeOutput(filePath, content, { force = false } = {}) {
  await fs.mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  try {
    await fs.writeFile(filePath, content, { flag: force ? 'w' : 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw new JsonCrafterError(`${filePath} already exists.`, {
        code: 'FILE_EXISTS',
        hint: 'Use --force to overwrite it, or choose another path with --output.',
      });
    }
    throw new JsonCrafterError(`Could not write ${filePath}: ${err.message}`, { code: 'WRITE_FAILED' });
  }
}
