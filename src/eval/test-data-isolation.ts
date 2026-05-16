import { readFile, writeFile } from "node:fs/promises";
import { resolveProjectPath } from "../data/load-json.js";

export async function withJsonFixture<T>(
  relativePath: string,
  fixtureRelativePath: string,
  fn: () => Promise<T> | T
): Promise<T> {
  const target = resolveProjectPath(relativePath);
  const fixture = resolveProjectPath(fixtureRelativePath);
  const snapshot = await readFile(target, "utf8").catch((): null => null);
  const fixtureContent = await readFile(fixture, "utf8");
  await writeFile(target, fixtureContent, "utf8");
  try {
    return await fn();
  } finally {
    if (snapshot !== null) {
      await writeFile(target, snapshot, "utf8");
    }
  }
}
