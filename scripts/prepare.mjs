import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { dependenciesReady } from "./dependency-state.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const ready = await dependenciesReady(root, pkg.dependencies);
if (!ready) {
  const options = { cwd: root, stdio: "inherit" };
  if (process.platform === "win32")
    execFileSync("cmd.exe", ["/d", "/s", "/c", "npm ci --omit=dev --ignore-scripts"], options);
  else execFileSync("npm", ["ci", "--omit=dev", "--ignore-scripts"], options);
}
process.chdir(root);
await import("./build.mjs");
