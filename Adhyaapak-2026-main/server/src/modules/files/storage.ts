import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Private file storage (CLAUDE.md §8). Callers see only opaque keys; there is no URL for a file,
 * so uploads cannot be fetched by anyone who does not go through an access-checked route.
 * A cloud object store can replace the local driver without changing callers.
 */
export interface StorageProvider {
  put(data: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[a-f0-9]{32}$/;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export class LocalStorage implements StorageProvider {
  private readonly base: string;

  constructor(baseDir: string) {
    this.base = isAbsolute(baseDir) ? baseDir : resolve(repoRoot, baseDir);
  }

  /** Keys are random hex, and every path is checked to stay inside the storage folder. */
  private pathFor(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key");
    const full = resolve(this.base, key);
    if (!full.startsWith(this.base + sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(data: Buffer): Promise<string> {
    const key = randomBytes(16).toString("hex");
    await mkdir(this.base, { recursive: true });
    await writeFile(this.pathFor(key), data, { flag: "wx" });
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
