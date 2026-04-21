// ─── Which utility ──────────────────────────────────────────────────

import { access, constants } from 'node:fs/promises';
import { join, delimiter } from 'node:path';

/**
 * Check if an executable exists on the system PATH.
 * Cross-platform: uses path.delimiter (`:` on Unix, `;` on Windows).
 * On Windows, also checks with common executable extensions.
 */
export async function which(command: string): Promise<boolean> {
  const paths = (process.env.PATH || '').split(delimiter);
  const isWin = process.platform === 'win32';
  const extensions = isWin
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
    : [''];

  for (const dir of paths) {
    for (const ext of extensions) {
      try {
        const candidate = join(dir, command + ext);
        await access(candidate, isWin ? constants.F_OK : constants.X_OK);
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}
