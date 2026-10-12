import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** @param {string} root @param {Record<string,string>} dependencies */
export async function dependenciesReady(root, dependencies) {
  for (const [name, version] of Object.entries(dependencies)) {
    try {
      if (
        JSON.parse(await readFile(join(root, "node_modules", name, "package.json"), "utf8"))
          .version !== version
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}
