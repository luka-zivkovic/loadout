import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { canonical, digest, jsonRead, jsonWrite, packFile, rejectSecrets, safePath, unpack, validateFiles, walk } from "./files.js";
import { harnessSchema, id, skillBodySchema, skillSchema, type Harness, type PackedFile, type Skill, type SkillPin } from "./schema.js";
import type { Store } from "./store.js";

export class SkillMetadataError extends Error {}
export function skillFrontmatter(text: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new SkillMetadataError("A skill needs YAML frontmatter with name and description");
  let value: unknown;
  try { value = parseYaml(match[1]!, { maxAliasCount: 0 }); }
  catch { throw new SkillMetadataError("Skill frontmatter is not valid YAML"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SkillMetadataError("Invalid skill frontmatter");
  if (!id.safeParse((value as Record<string, unknown>).name).success || !skillBodySchema.shape.description.safeParse((value as Record<string, unknown>).description).success) throw new SkillMetadataError("Skill frontmatter needs a supported name and description");
  return value as Record<string, unknown>;
}
export function sealSkill(raw: Omit<Skill, "revision">): Skill {
  const body = skillBodySchema.parse(raw); validateFiles(body.files);
  rejectSecrets("skill-metadata", Buffer.from(canonical({ ...body, files: [] })));
  if (body.files.some(f => f.path === ".pi-share-skill.json")) throw new Error("Skill bundle uses a reserved installation receipt path");
  body.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (new Set(body.compatibleWith).size !== body.compatibleWith.length) throw new Error("Duplicate skill compatibility entry");
  const entry = body.files.find(f => f.path === "SKILL.md");
  if (!entry) throw new Error("Skill bundle must contain SKILL.md at its root");
  const frontmatter = skillFrontmatter(Buffer.from(entry.data, "base64").toString("utf8"));
  if (frontmatter.name !== body.name || frontmatter.description !== body.description) throw new Error("Skill metadata must match SKILL.md");
  return { ...body, revision: digest(canonical(body)) };
}
export function validateSkill(raw: unknown): Skill {
  const skill = skillSchema.parse(raw); const { revision, ...body } = skill;
  const sealed = sealSkill(body);
  if (sealed.revision !== revision) throw new Error("Skill revision does not match its contents");
  return sealed;
}
export function captureSkill(options: { dir: string; scope: "work" | "personal"; compatibleWith?: Harness[]; requirements?: string[] }): Skill {
  const root = resolve(options.dir); const frontmatter = skillFrontmatter(readFileSync(join(root, "SKILL.md"), "utf8"));
  const receiptPath = join(root, ".pi-share-skill.json");
  const receipt = existsSync(receiptPath) ? skillSchema.omit({ files: true }).parse(jsonRead(receiptPath)) : undefined;
  const portableFields = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
  const nativeFields = Object.keys(frontmatter).filter(k => !portableFields.has(k));
  if (!options.compatibleWith && !receipt && nativeFields.length) throw new Error(`Declare --compatible for a skill with harness-specific frontmatter (${nativeFields.join(", ")})`);
  const requirements = [...new Set([...(options.requirements ?? receipt?.requirements ?? []), ...(typeof frontmatter.compatibility === "string" ? [frontmatter.compatibility] : [])])];
  return sealSkill({ schemaVersion: 1, kind: "skill", name: id.parse(frontmatter.name), scope: options.scope,
    description: String(frontmatter.description ?? ""), compatibleWith: options.compatibleWith ?? receipt?.compatibleWith ?? ["pi", "claude-code", "codex"], requirements,
    files: walk(root, new Set([".git", "node_modules", ".DS_Store", "sessions", "memory", ".pi-share-skill.json"])).map(path => packFile(relative(root, path).split("\\").join("/"), readFileSync(path), Boolean(lstatSync(path).mode & 0o111))),
  });
}
export function saveSkill(store: Store, raw: Skill, alias = raw.name): Skill {
  const skill = validateSkill(raw); id.parse(alias);
  if (skill.scope !== store.scope) throw new Error("Skill scope does not match this store");
  const path = join(store.dir, "skills", `${skill.revision}.json`);
  if (!existsSync(path)) jsonWrite(path, skill);
  jsonWrite(join(store.dir, "skill-names", `${alias}.json`), { revision: skill.revision }, true); return skill;
}
export function getSkill(store: Store, ref: string): Skill {
  if (existsSync(ref) && lstatSync(ref).isFile()) return validateSkill(jsonRead(ref));
  id.parse(ref);
  const revision = /^[a-f0-9]{64}$/.test(ref) ? ref : (jsonRead(join(store.dir, "skill-names", `${ref}.json`)) as { revision: string }).revision;
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error("Invalid skill revision");
  return validateSkill(jsonRead(join(store.dir, "skills", `${revision}.json`)));
}
export function listSkills(store: Store) {
  const dir = join(store.dir, "skill-names");
  return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(".json")).sort().map(f => ({ localName: f.slice(0, -5), skill: getSkill(store, f.slice(0, -5)) })) : [];
}
export function skillDestination(name: string, harness: Harness, project?: string, userHome = homedir()): string {
  id.parse(name); harnessSchema.parse(harness);
  const root = project ? resolve(project) : userHome;
  return join(root, harness === "pi" ? project ? ".pi/skills" : ".pi/agent/skills" : harness === "claude-code" ? ".claude/skills" : ".agents/skills", name);
}
export function assertNoSymlinkAncestors(path: string) {
  let dir = resolve(path);
  while (true) {
    try {
      if (lstatSync(dir).isSymbolicLink() && !(process.platform === "darwin" && ["/var", "/tmp", "/etc"].includes(dir) && realpathSync(dir) === `/private${dir}`)) throw new Error("Install destination must not pass through a symlink");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (dirname(dir) === dir) break; dir = dirname(dir);
  }
}
export function installSkill(skill: Skill, harness: Harness, dest: string) {
  validateSkill(skill); harnessSchema.parse(harness);
  if (!skill.compatibleWith.includes(harness)) throw new Error(`This skill does not declare compatibility with ${harness}`);
  assertNoSymlinkAncestors(dest);
  if (skill.files.some(f => f.path === ".pi-share-skill.json")) throw new Error("Skill bundle uses a reserved installation receipt path");
  const { files, ...receipt } = skill;
  unpack([...files, packFile(".pi-share-skill.json", Buffer.from(JSON.stringify(receipt)))], resolve(dest)); return resolve(dest);
}
export function makeSkillPin(skill: Skill, path: string): SkillPin {
  validateSkill(skill); safePath(path);
  const { kind, schemaVersion, files, scope, ...pin } = skill; return { ...pin, path };
}
export function pinnedSkill(pin: SkillPin, files: PackedFile[], scope: "work" | "personal"): Skill {
  safePath(pin.path); const { path, ...meta } = pin;
  return validateSkill({ schemaVersion: 1, kind: "skill", scope, ...meta,
    files: files.filter(f => f.path.startsWith(`${path}/`)).map(f => ({ ...f, path: f.path.slice(path.length + 1) })),
  });
}
export function validateSkillPins(pins: SkillPin[], files: PackedFile[], scope: "work" | "personal", harness: Harness, resources: string[]) {
  const names = new Set<string>();
  for (const pin of pins) {
    if (names.has(pin.name)) throw new Error("Duplicate pinned skill name"); names.add(pin.name);
    if (!resources.some(path => pin.path === path || pin.path.startsWith(`${path}/`) || path === `${pin.path}/SKILL.md`)) throw new Error(`Pinned skill ${pin.name} is missing from setup resources`);
    const skill = pinnedSkill(pin, files, scope);
    if (!skill.compatibleWith.includes(harness)) throw new Error(`Pinned skill ${skill.name} is incompatible with ${harness}`);
  }
}
