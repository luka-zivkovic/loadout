import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { PackedFile } from "./schema.js";
import { embeddedCapability } from "./secrets.js";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
export function safePath(path: string): string {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    /[\x00-\x1f:]/.test(path) ||
    path.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw new Error("Unsafe relative artifact path");
  return path;
}
export function inside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}
export function ensureDir(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
}
export function jsonRead(path: string): unknown {
  if (lstatSync(path).size > 64 * 1024 * 1024)
    throw new Error("JSON artifact exceeds 64 MiB");
  return JSON.parse(readFileSync(path, "utf8"));
}
export function jsonWrite(path: string, value: unknown, overwrite = false) {
  ensureDir(dirname(path));
  if (!overwrite && existsSync(path))
    throw new Error(`File already exists: ${path}`);
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  renameSync(tmp, path);
}
export function walk(root: string, skip: Set<string> = new Set()): string[] {
  const result: string[] = [];
  const visit = (path: string) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink())
      throw new Error(`Symlinks are not portable: ${path}`);
    if (stat.isDirectory())
      for (const entry of readdirSync(path).sort()) {
        if (!skip.has(entry)) visit(join(path, entry));
      }
    else if (stat.isFile()) result.push(path);
    else throw new Error(`Unsupported file type: ${path}`);
  };
  visit(root);
  return result;
}
export function rejectSecrets(path: string, bytes: Buffer) {
  if (
    /(^|\/)(auth\.json|models\.json|\.env(?:\..*)?|credentials(?:\..*)?|id_rsa|id_ed25519)$/i.test(
      path,
    )
  )
    throw new Error(`Credential file cannot enter a profile: ${path}`);
  const text = bytes.toString("utf8");
  // Exempt exact n8n credential references only when their quotes match.
  const assignedCredential = /["']?(?:api[_-]?key|access[_-]?token|secret|password)["']?\s*[:=]\s*(["'])([^"'\s]{12,})(["'])/gi;
  const hasLiteralCredential = [...text.matchAll(assignedCredential)].some(([, opening, value, closing]) =>
    opening !== closing || !/^=\{\{\$credentials(?:\.[A-Za-z_$][\w$]*)+\}\}$/.test(value!),
  );
  if (
    embeddedCapability.test(text) ||
    /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\b(?:sk-(?:ant-)?[a-zA-Z0-9_-]{20,}|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/.test(
      text,
    ) ||
    hasLiteralCredential
  )
    throw new Error(
      `Possible embedded credential in ${path}; replace it with a local environment reference`,
    );
}
export function packFile(
  path: string,
  bytes: Buffer,
  executable = false,
): PackedFile {
  safePath(path);
  rejectSecrets(path, bytes);
  if (bytes.length > 5_000_000)
    throw new Error(`Profile file is too large: ${path}`);
  return {
    path,
    data: bytes.toString("base64"),
    sha256: digest(bytes),
    ...(executable ? { executable: true as const } : {}),
  };
}
export function validateFiles(files: PackedFile[]) {
  const seen = new Set<string>();
  let size = 0;
  for (const file of files) {
    safePath(file.path);
    const key = file.path.toLowerCase();
    if (seen.has(key))
      throw new Error("Duplicate or case-colliding artifact path");
    seen.add(key);
    const bytes = Buffer.from(file.data, "base64");
    size += bytes.length;
    if (bytes.toString("base64") !== file.data || digest(bytes) !== file.sha256)
      throw new Error("Profile file hash mismatch");
    rejectSecrets(file.path, bytes);
  }
  for (const path of seen)
    for (const other of seen)
      if (path.startsWith(`${other}/`))
        throw new Error("File/directory collision");
  if (size > 30_000_000) throw new Error("Profile bundle exceeds 30 MB");
}
export function unpack(files: PackedFile[], dest: string) {
  validateFiles(files);
  if (existsSync(dest)) throw new Error(`Destination exists: ${dest}`);
  ensureDir(dest);
  try {
    for (const file of files) {
      const target = join(dest, safePath(file.path));
      ensureDir(dirname(target));
      writeFileSync(target, Buffer.from(file.data, "base64"), {
        flag: "wx",
        mode: file.executable ? 0o700 : 0o600,
      });
    }
  } catch (e) {
    rmSync(dest, { recursive: true, force: true });
    throw e;
  }
}
export function containedRealPath(root: string, requested: string): string {
  const path = realpathSync(resolve(root, requested));
  if (!inside(realpathSync(root), path))
    throw new Error("Path is outside the permitted context");
  return path;
}
