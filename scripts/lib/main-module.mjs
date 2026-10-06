import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * True when the module at `moduleUrl` (its `import.meta.url`) is the script
 * Node was started with, so a file can be both a command and an importable
 * library. Symlinked paths (npm bin links, worktrees) resolve first. Node
 * builtins only: the hourly monitors run scripts without installing packages.
 */
export function isMainModule(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}
