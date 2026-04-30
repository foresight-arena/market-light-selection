import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw e;
  }
}

export async function writeJsonFile(
  filePath: string,
  value: unknown,
  pretty = true
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const payload = (pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + "\n";
  await writeFile(filePath, payload, "utf8");
}
