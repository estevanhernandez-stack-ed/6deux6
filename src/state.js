import { readFile, writeFile } from "node:fs/promises";

export async function loadState(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function saveState(path, state) {
  await writeFile(path, JSON.stringify(state, null, 2) + "\n");
}
