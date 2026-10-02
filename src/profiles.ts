import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { canonical, digest, jsonRead, jsonWrite, packFile, rejectSecrets, safePath, unpack, validateFiles, walk } from "./files.js";
import { PI_VERSION, id, profileBodySchema, profileSchema, settingsSchema, type Profile, type ProfileBody } from "./schema.js";
import type { Store } from "./store.js";
import { captureSkill, makeSkillPin, validateSkillPins } from "./skills.js";

export const DEFAULT_REVIEW = "Review the change described in PR.diff against the repository in repo/. Use the provided project instructions and context/. Report actionable defects introduced by this change, with file and line references, impact, and evidence. Avoid speculative findings. Do not modify files. End with a concise review.";
const builtinExtensions = ["mcp", "llama.cpp", "codemode", "tool-search"] as const;

export function assertPinned(source: string) {
  const npm = /^npm:(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+@\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
  const git = /^git:(?:https:\/\/|ssh:\/\/git@|git@)?[a-zA-Z0-9._/-]+(?:[:/][a-zA-Z0-9._/-]+)?@[a-f0-9]{40}$/;
  if (!npm.test(source) && !git.test(source)) throw new Error(`Package must use an exact npm version or a 40-character git commit: ${source}`);
}
export function sealProfile(raw: ProfileBody): Profile {
  const body = profileBodySchema.parse(raw); validateFiles(body.files); body.packages.forEach(assertPinned);
  validateSkillPins(body.skillPins ?? [], body.files, body.scope, "pi", body.resources.skills);
  rejectSecrets("workflow.md", Buffer.from(body.workflow.prompt));
  rejectSecrets("setup-metadata", Buffer.from(canonical({ ...body, files: [] })));
  const files = new Set(body.files.map(f => f.path));
  for (const path of [...body.instructions, ...(body.systemPrompt ? [body.systemPrompt] : []), ...body.appendSystemPrompt]) {
    safePath(path); if (!files.has(path)) throw new Error(`Missing instruction file: ${path}`);
  }
  for (const path of Object.values(body.resources).flat()) {
    safePath(path); if (!body.files.some(f => f.path === path || f.path.startsWith(`${path}/`))) throw new Error(`Missing resource: ${path}`);
  }
  return { ...body, revision: digest(canonical(body)) };
}
export function validateProfile(raw: unknown): Profile {
  const parsed = profileSchema.parse(raw); const { revision, ...body } = parsed;
  if (sealProfile(body).revision !== revision) throw new Error("Profile revision does not match its contents");
  return parsed;
}
export function saveProfile(store: Store, profile: Profile, alias = profile.name): Profile {
  validateProfile(profile);
  id.parse(alias);
  if (profile.scope !== store.scope) throw new Error("Profile scope does not match the selected store");
  const path = join(store.dir, "profiles", `${profile.revision}.json`);
  if (!existsSync(path)) jsonWrite(path, profile);
  jsonWrite(join(store.dir, "names", `${alias}.json`), { revision: profile.revision }, true);
  return profile;
}
export function getProfile(store: Store, ref: string): Profile {
  if (existsSync(ref) && lstatSync(ref).isFile()) return validateProfile(jsonRead(ref));
  id.parse(ref);
  let revision = ref;
  if (!/^[a-f0-9]{64}$/.test(ref)) {
    const value = jsonRead(join(store.dir, "names", `${ref}.json`)) as { revision: string }; revision = value.revision;
  }
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error("Invalid profile revision");
  return validateProfile(jsonRead(join(store.dir, "profiles", `${revision}.json`)));
}
export function listProfiles(store: Store): Profile[] {
  const dir = join(store.dir, "names");
  return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(".json")).sort().flatMap(f => {
    const ref = jsonRead(join(dir, f)) as { revision: string }; const raw = jsonRead(join(store.dir, "profiles", `${ref.revision}.json`)) as { schemaVersion: number };
    return raw.schemaVersion === 2 ? [] : [validateProfile(raw)];
  }) : [];
}
export function materializeProfile(profile: Profile, dest: string) { validateProfile(profile); unpack(profile.files, dest); }

function readSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const value = jsonRead(path);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Expected a settings object: ${path}`);
  return value as Record<string, unknown>;
}
export function captureProfile(options: { name: string; scope: "personal" | "work"; agentDir: string; project?: string; workflowId?: string; prompt?: string; model?: string }): Profile {
  id.parse(options.name);
  const agentDir = resolve(options.agentDir);
  if (!existsSync(agentDir)) throw new Error(`Pi directory does not exist: ${agentDir}`);
  const layers = [{ dir: agentDir, label: "global", settings: readSettings(join(agentDir, "settings.json")) }];
  if (options.project) layers.push({ dir: join(resolve(options.project), ".pi"), label: "project", settings: readSettings(join(resolve(options.project), ".pi/settings.json")) });
  const merged = Object.assign({}, ...layers.map(l => l.settings));
  for (const key of ["compaction", "retry", "thinkingBudgets"]) {
    const parts = layers.map(l => l.settings[key]).filter(v => v && typeof v === "object");
    if (parts.length) merged[key] = Object.assign({}, ...parts);
  }
  if (options.model) {
    const slash = options.model.indexOf("/"); if (slash < 1) throw new Error("Model must be provider/model-id");
    merged.defaultProvider = options.model.slice(0, slash); merged.defaultModel = options.model.slice(slash + 1);
  }
  const allowed = Object.keys(settingsSchema.shape);
  const settings = settingsSchema.parse(Object.fromEntries(Object.entries(merged).filter(([k]) => k !== "extensions" && allowed.includes(k))));
  const body: ProfileBody = {
    schemaVersion: 1, name: options.name, scope: options.scope, piVersion: PI_VERSION, settings,
    workflow: { id: options.workflowId ?? "pr-review", prompt: options.prompt ?? DEFAULT_REVIEW },
    packages: [], resources: { extensions: [], skills: [], prompts: [] }, instructions: [], appendSystemPrompt: [], requirements: [],
    omittedSettings: Object.keys(merged).filter(k => !allowed.includes(k) && !["packages", "extensions", "skills", "prompts"].includes(k)).sort(), files: [],
  };
  const copied = new Map<string, string>();
  const builtinOverrides = new Map<string, "+" | "-">();
  function copy(source: string, target: string): string {
    const path = resolve(source); const existing = copied.get(path); if (existing) return existing;
    const stat = lstatSync(path); if (stat.isSymbolicLink()) throw new Error(`Resolve symlinked resource before capture: ${source}`);
    const entries = stat.isDirectory() ? walk(path, new Set(["node_modules", ".git", "sessions", "memory", ".pi-share-skill.json"])) : [path];
    if (!entries.length) return "";
    for (const file of entries) {
      const packedPath = stat.isDirectory() ? `${target}/${relative(path, file).split("\\").join("/")}` : target;
      body.files.push(packFile(packedPath, readFileSync(file), Boolean(lstatSync(file).mode & 0o111)));
      if (basename(file) === "SKILL.md" && existsSync(join(dirname(file), ".pi-share-skill.json"))) {
        const skill = captureSkill({ dir: dirname(file), scope: body.scope });
        (body.skillPins ??= []).push(makeSkillPin(skill, dirname(packedPath).split("\\").join("/")));
      }
    }
    copied.set(path, target); return target;
  }
  for (const layer of layers) {
    for (const kind of ["extensions", "skills", "prompts"] as const) {
      const dir = join(layer.dir, kind);
      if (existsSync(dir)) {
        const ref = copy(dir, `${layer.label}/${kind}`);
        if (ref && kind === "extensions") {
          for (const child of readdirSync(dir).sort()) {
            const childPath = join(dir, child);
            if (lstatSync(childPath).isFile() && /\.(?:ts|js|mjs|cjs)$/.test(child) || lstatSync(childPath).isDirectory() && ["index.ts", "index.js", "package.json"].some(n => existsSync(join(childPath, n)))) body.resources.extensions.push(`${ref}/${child}`);
          }
        } else if (ref) body.resources[kind].push(ref);
      }
      const explicit = layer.settings[kind] ?? [];
      if (!Array.isArray(explicit)) throw new Error(`Expected ${kind} to be an array`);
      const layerBuiltinOverrides = new Map<string, "+" | "-">();
      for (const [i, value] of explicit.entries()) {
        if (kind === "extensions" && typeof value === "string") {
          const builtin = /^([!+-])builtin:([a-z0-9.-]+)$/.exec(value);
          if (builtin) {
            const operation = builtin[1]!;
            const name = builtin[2]!;
            if (!builtinExtensions.some(known => known === name)) throw new Error(`Unknown Pi built-in extension: ${name}`);
            // Within one Pi settings layer, a force exclusion wins over an
            // inclusion. A project layer then overrides the global layer.
            if (operation !== "+" || layerBuiltinOverrides.get(name) !== "-") layerBuiltinOverrides.set(name, operation === "+" ? "+" : "-");
            continue;
          }
        }
        if (typeof value !== "string" || /^[!+-]/.test(value) || /[*?\[\]]/.test(value)) throw new Error(`Capture does not support ${kind} selection patterns; use explicit resource paths`);
        const src = value.startsWith("~/") ? join(homedir(), value.slice(2)) : resolve(layer.dir, value);
        const target = `${layer.label}/extra-${kind}/${i}/${basename(src)}`;
        const ref = copy(src, target); if (ref && !body.resources[kind].includes(ref)) body.resources[kind].push(ref);
      }
      for (const [name, operation] of layerBuiltinOverrides) builtinOverrides.set(name, operation);
    }
    if (layer.settings.packages !== undefined && !Array.isArray(layer.settings.packages)) throw new Error("Expected packages to be an array");
    for (const source of (layer.settings.packages ?? []) as unknown[]) {
      if (typeof source !== "string") throw new Error("Filtered package declarations need to be converted to an explicit profile before capture");
      assertPinned(source);
      const identity = source.slice(0, source.lastIndexOf("@"));
      const previous = body.packages.findIndex(p => p.slice(0, p.lastIndexOf("@")) === identity);
      if (previous < 0) body.packages.push(source); else body.packages[previous] = source;
    }
    // Repository AGENTS files belong to the frozen task; global instructions belong to the harness.
    if (layer.label === "global") {
      const path = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"].map(n => join(layer.dir, n)).find(existsSync);
      if (path) body.instructions.push(copy(path, `global/${basename(path)}`));
    }
    if (existsSync(join(layer.dir, "SYSTEM.md"))) body.systemPrompt = copy(join(layer.dir, "SYSTEM.md"), `${layer.label}/SYSTEM.md`);
    if (existsSync(join(layer.dir, "APPEND_SYSTEM.md"))) body.appendSystemPrompt = [copy(join(layer.dir, "APPEND_SYSTEM.md"), `${layer.label}/APPEND_SYSTEM.md`)];
  }
  if (builtinOverrides.size) body.settings.extensions = settingsSchema.shape.extensions.parse(
    [...builtinOverrides].sort(([a], [b]) => a.localeCompare(b)).map(([name, operation]) => `${operation}builtin:${name}`),
  );
  // Pi also discovers the standard shared skills directory. Include it only for the standard user profile.
  const shared = join(homedir(), ".agents/skills");
  if (agentDir === join(homedir(), ".pi/agent") && existsSync(shared)) {
    const ref = copy(shared, "shared/skills"); if (ref) body.resources.skills.push(ref);
  }
  if (options.project) {
    let dir = resolve(options.project);
    while (true) {
      const sharedProject = join(dir, ".agents/skills");
      if (existsSync(sharedProject)) { const ref = copy(sharedProject, `project-shared/${body.resources.skills.length}`); if (ref) body.resources.skills.push(ref); }
      if (existsSync(join(dir, ".git")) || dirname(dir) === dir) break;
      dir = dirname(dir);
    }
  }
  body.requirements.push(`model-access:${settings.defaultProvider}/${settings.defaultModel}`);
  if (existsSync(join(agentDir, "models.json"))) body.requirements.push("local-model-definitions: models.json stays on the receiving device");
  body.files.sort((a, b) => a.path.localeCompare(b.path));
  return sealProfile(body);
}

export function exampleProfile(name: string, targetScope: "work" | "personal", model: string, thorough = false): Profile {
  const slash = model.indexOf("/"); if (slash < 1) throw new Error("Model must be provider/model-id");
  const skill = `---\nname: review\ndescription: Review a pull request for actionable correctness defects.\n---\n\nRead PR.diff, relevant files in repo/, and supplied context/.\n${thorough ? "Trace changed values through callers and callees. Check boundary conditions, failure handling, and authorization. Verify each finding against concrete code before reporting it." : "Inspect changed lines and their immediate surroundings. Report clear bugs with evidence."}\nGive each finding a file, line, severity, explanation, and a suggested fix. Do not modify files.\n`;
  return sealProfile({ schemaVersion: 1, name, scope: targetScope, piVersion: PI_VERSION,
    settings: { defaultProvider: model.slice(0, slash), defaultModel: model.slice(slash + 1), defaultThinkingLevel: "medium", defaultTools: ["read", "grep", "find", "ls"] },
    workflow: { id: "pr-review", prompt: "/skill:review Review this frozen change." }, packages: [],
    resources: { extensions: [], skills: ["skills"], prompts: [] }, instructions: [], appendSystemPrompt: [],
    requirements: [], omittedSettings: [], files: [packFile("skills/review/SKILL.md", Buffer.from(skill))],
  });
}
