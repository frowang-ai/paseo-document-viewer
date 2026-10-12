import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dependenciesReady } from "../scripts/dependency-state.mjs";

test("preparation requires its own locked dependencies, not packages from an ancestor", async () => {
  const root = await mkdtemp(join(tmpdir(), "paseo-prepare-test-"));
  try {
    await mkdir(join(root, "node_modules", "example-library"), { recursive: true });
    await writeFile(
      join(root, "node_modules", "example-library", "package.json"),
      JSON.stringify({ version: "1.0.0" }),
    );
    const plugin = join(root, "plugin");
    await mkdir(plugin);
    assert.equal(await dependenciesReady(plugin, { "example-library": "1.0.0" }), false);
    await mkdir(join(plugin, "node_modules", "example-library"), { recursive: true });
    await writeFile(
      join(plugin, "node_modules", "example-library", "package.json"),
      JSON.stringify({ version: "1.0.0" }),
    );
    assert.equal(await dependenciesReady(plugin, { "example-library": "1.0.0" }), true);
    assert.equal(await dependenciesReady(plugin, { "example-library": "2.0.0" }), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
