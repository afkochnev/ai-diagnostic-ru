import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { EvidenceError, parseJson, parsePlan, sha256, type Artifact, type Plan } from "./contract";
import type { Objects } from "./evaluate";

const PLAN_LIMIT = 256 * 1024;
export type Loaded = { plan: Plan; objects: Objects; plan_sha256: string };
function checkPin(pin: string): void {
  if (!/^[a-f0-9]{64}$/.test(pin)) throw new EvidenceError("PLAN_PIN_INVALID");
}
export function checkRelativePath(path: string): void {
  if (isAbsolute(path) || path.length > 240 || path.includes("\\") || path.includes("\0")
    || !/^[a-zA-Z0-9._/-]+$/.test(path)
    || path.split("/").some(p => p === "" || p === "." || p === ".."))
    throw new EvidenceError("ARTIFACT_PATH_INVALID");
}
async function readLocal(root: string, path: string, limit: number): Promise<Uint8Array> {
  checkRelativePath(path);
  let cursor = root;
  const parts = path.split("/");
  for (const [index, part] of parts.entries()) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink()) throw new EvidenceError("ARTIFACT_SYMLINK_FORBIDDEN");
    if (index < parts.length - 1 && !stat.isDirectory()) throw new EvidenceError("ARTIFACT_NOT_DIRECTORY");
  }
  const handle = await open(cursor, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new EvidenceError("ARTIFACT_NOT_REGULAR_FILE");
    if (stat.size > limit) throw new EvidenceError("ARTIFACT_TOO_LARGE");
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new EvidenceError("ARTIFACT_TOO_LARGE");
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}
function refs(plan: Plan): { ref: Artifact; limit: number }[] {
  return [
    { ref: plan.prompt, limit: 128 * 1024 }, { ref: plan.schema, limit: 32 * 1024 },
    ...plan.cases.flatMap(c => [
      { ref: c.input, limit: 256 * 1024 },
      ...(c.raw ? [{ ref: c.raw, limit: 1024 * 1024 }] : []),
      ...c.reviews.map(ref => ({ ref, limit: 256 * 1024 })),
    ]),
  ];
}
async function load(planBytes: Uint8Array, pin: string, root: string, sealed: boolean): Promise<Loaded> {
  checkPin(pin);
  if (sha256(planBytes) !== pin) throw new EvidenceError("PLAN_PIN_MISMATCH");
  const plan = parsePlan(parseJson(planBytes));
  const objects = new Map<string, Uint8Array>();
  for (const { ref, limit } of refs(plan)) {
    // Also validate original names in sealed plans; never interpret them as external references.
    checkRelativePath(ref.path);
    const bytes = await readLocal(root, sealed ? `objects/${ref.sha256}` : ref.path, limit);
    if (sha256(bytes) !== ref.sha256) throw new EvidenceError("ARTIFACT_HASH_MISMATCH");
    objects.set(ref.sha256, bytes);
  }
  return { plan, objects, plan_sha256: pin };
}
export async function loadPlan(planPath: string, pin: string): Promise<Loaded> {
  const absolute = resolve(planPath);
  const root = await realpath(dirname(absolute));
  const bytes = await readLocal(root, basename(absolute), PLAN_LIMIT);
  return load(bytes, pin, root, false);
}
export async function loadBundle(bundleDir: string, pin: string): Promise<Loaded> {
  const root = await realpath(resolve(bundleDir));
  const bytes = await readLocal(root, "plan.json", PLAN_LIMIT);
  return load(bytes, pin, root, true);
}
export async function bundle(planPath: string, pin: string, outDir: string): Promise<Loaded> {
  const loaded = await loadPlan(planPath, pin);
  const planAbsolute = resolve(planPath);
  const bytes = await readLocal(await realpath(dirname(planAbsolute)), basename(planAbsolute), PLAN_LIMIT);
  if (sha256(bytes) !== pin) throw new EvidenceError("PLAN_PIN_MISMATCH");
  const absolute = resolve(outDir);
  const parent = await realpath(dirname(absolute));
  const destination = join(parent, basename(absolute));
  // Non-recursive creation refuses an existing output. Write the pinned plan last;
  // interrupted bundles lack their entry point and cannot be evaluated.
  await mkdir(destination, { mode: 0o700 });
  await mkdir(join(destination, "objects"), { mode: 0o700 });
  for (const [hash, object] of loaded.objects)
    await writeFile(join(destination, "objects", hash), object, { flag: "wx", mode: 0o600 });
  await writeFile(join(destination, "plan.json"), bytes, { flag: "wx", mode: 0o600 });
  return loaded;
}
