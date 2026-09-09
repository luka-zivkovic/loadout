import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { canonical, digest, ensureDir, inside, jsonRead, jsonWrite, safePath, walk } from "./files.js";
import { packetSchema, type Packet } from "./schema.js";

function git(repo: string, args: string[]): Buffer { return execFileSync("git", ["-C", repo, ...args], { maxBuffer: 64 * 1024 * 1024, timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }); }
function commit(repo: string, ref: string) { return git(repo, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).toString().trim(); }
export function packetFiles(dir: string) {
  return walk(dir, new Set([".git"])).filter(p => p !== join(dir, "packet.json")).map(p => ({ path: relative(dir, p).split("\\").join("/"), sha256: digest(readFileSync(p)) })).sort((a, b) => a.path.localeCompare(b.path));
}
export function freezeContext(options: { repo: string; base: string; head: string; out: string; context?: string }): Packet {
  const repo = resolve(options.repo); const out = resolve(options.out);
  if (existsSync(out)) throw new Error("Frozen context destination already exists");
  if (options.context && inside(resolve(options.context), out)) throw new Error("Output cannot be inside the additional context directory");
  const base = commit(repo, options.base); const head = commit(repo, options.head);
  const tree = git(repo, ["ls-tree", "-rz", "--full-tree", head]).toString().split("\0").filter(Boolean);
  for (const entry of tree) {
    const tab = entry.indexOf("\t"); const [mode] = entry.slice(0, tab).split(" "); const path = entry.slice(tab + 1);
    safePath(path);
    if (mode !== "100644" && mode !== "100755") throw new Error(`Snapshot requires regular files; symlinks and submodules are unsupported: ${path}`);
  }
  const history = mkdtempSync(join(tmpdir(), "pi-share-history-"));
  ensureDir(join(out, "repo")); ensureDir(join(out, "context"));
  try {
    // Read exact blobs; git archive can apply export-ignore/export-subst attributes.
    const objects = tree.map(entry => { const [meta, path] = entry.split("\t"); const [mode, , object] = meta!.split(" "); return { mode, object, path: path! }; });
    const blobs = objects.length ? execFileSync("git", ["-C", repo, "cat-file", "--batch"], {
      input: objects.map(o => o.object).join("\n") + "\n", maxBuffer: 64 * 1024 * 1024, timeout: 60_000, stdio: ["pipe", "pipe", "pipe"],
    }) : Buffer.alloc(0);
    let offset = 0;
    for (const object of objects) {
      const end = blobs.indexOf(10, offset); const header = blobs.subarray(offset, end).toString(); const size = Number(header.split(" ")[2]);
      if (end < 0 || !Number.isSafeInteger(size) || size < 0) throw new Error("Invalid Git blob response");
      offset = end + 1; const target = join(out, "repo", object.path); ensureDir(dirname(target));
      writeFileSync(target, blobs.subarray(offset, offset + size), { mode: object.mode === "100755" ? 0o700 : 0o600 });
      offset += size + 1;
    }
    writeFileSync(join(out, "PR.diff"), git(repo, ["diff", "--no-ext-diff", "--no-textconv", "--binary", base, head, "--"]), { mode: 0o600 });
    git(history, ["init", "--bare", "-q"]);
    git(history, ["-c", "protocol.file.allow=always", "fetch", "--no-tags", repo, `${base}:refs/heads/base`, `${head}:refs/heads/review`]);
    git(history, ["bundle", "create", join(out, "history.bundle"), "refs/heads/base", "refs/heads/review"]);
    if (options.context) {
      const src = resolve(options.context);
      if (!lstatSync(src).isDirectory()) throw new Error("--context must name a directory");
      for (const file of walk(src)) {
        const target = join(out, "context", safePath(relative(src, file).split("\\").join("/"))); ensureDir(dirname(target)); cpSync(file, target);
      }
    }
    const body = { schemaVersion: 1 as const, base, head, files: packetFiles(out) };
    const packet = packetSchema.parse({ ...body, contextHash: digest(canonical(body)) });
    jsonWrite(join(out, "packet.json"), packet); return packet;
  } catch (error) { rmSync(out, { recursive: true, force: true }); throw error; }
  finally { rmSync(history, { recursive: true, force: true }); }
}
export function validatePacket(dir: string): Packet {
  const packet = packetSchema.parse(jsonRead(join(dir, "packet.json"))); const { contextHash, ...body } = packet;
  for (const file of packet.files) safePath(file.path);
  if (digest(canonical(body)) !== contextHash || canonical(packetFiles(dir)) !== canonical(packet.files)) throw new Error("Frozen context changed; create a new packet before comparing");
  return packet;
}
export function copyPacket(src: string, dest: string): Packet {
  const packet = validatePacket(src);
  if (existsSync(dest)) throw new Error("Run workspace exists");
  cpSync(src, dest, { recursive: true, errorOnExist: true, force: false }); return packet;
}
export function restoreReviewGit(workspace: string, packet: Packet) {
  const repo = join(workspace, "repo");
  git(repo, ["init", "-q"]);
  git(repo, ["fetch", "--no-tags", join(workspace, "history.bundle"), "refs/heads/base:refs/heads/base", "refs/heads/review:refs/heads/review"]);
  git(repo, ["symbolic-ref", "HEAD", "refs/heads/review"]);
  git(repo, ["reset", "--mixed", packet.head]);
}
