import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { canonical, digest, jsonRead, jsonWrite, packFile, rejectSecrets, safePath, unpack, validateFiles, walk } from "./files.js";
import { captureProfile, sealProfile, validateProfile } from "./profiles.js";
import { id, nativeSetupBodySchema, nativeSetupSchema, setupHarness, setupSchema, type Harness, type NativeSetup, type Setup, type Skill } from "./schema.js";
import { assertNoSymlinkAncestors, captureSkill, makeSkillPin, SkillMetadataError, validateSkillPins } from "./skills.js";
import type { Store } from "./store.js";

const keys: Record<"claude-code" | "codex", string[]> = {
  "claude-code": ["model", "effortLevel", "outputStyle", "language", "permissions", "hooks", "enabledPlugins", "agent", "teammateMode"],
  codex: ["model", "model_reasoning_effort", "model_reasoning_summary", "model_verbosity", "personality", "developer_instructions", "approval_policy", "sandbox_mode", "web_search", "hooks", "features"],
};
const DEFAULT_NATIVE_REVIEW = "Review the requested change in the current local project. Follow its project instructions and trace the affected behavior. Report actionable defects with file and line references, impact, and evidence. Do not modify files. Keep the code and review output local.";
export const nativeAgentDir = (h: Harness) => h === "pi" ? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent") : h === "claude-code" ? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude") : process.env.CODEX_HOME ?? join(homedir(), ".codex");
export function detectedVersion(harness: Harness): string {
  try { const value = execFileSync(harness === "claude-code" ? "claude" : harness, ["--version"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }); return /\d+\.\d+\.\d+(?:[-+][\w.-]+)?/.exec(value)?.[0] ?? "unknown"; }
  catch { return "unknown"; }
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a settings object"); return value as Record<string, unknown>; }
function mcpNames(raw: unknown): string[] { return Object.keys(object(raw)).map(name => id.parse(name)); }
/** Legacy v2 definitions are read for revision verification, never captured again. */
function selectedMcp(raw: unknown, omitted: string[]) {
  return Object.fromEntries(Object.entries(object(raw)).map(([name, server]) => {
    id.parse(name);
    const clean = Object.fromEntries(Object.entries(object(server)).filter(([key]) => {
      const keep = ["type", "command", "args", "url"].includes(key); if (!keep) omitted.push(`mcp.${name}.${key}`); return keep;
    }));
    if (clean.url) { const url = new URL(String(clean.url)); if (url.username || url.password || url.search || url.hash) throw new Error("MCP URLs must not contain credentials or query parameters"); }
    rejectSecrets("mcp-definition", Buffer.from(canonical(clean))); return [name, clean];
  }));
}
/** Credentials, telemetry destinations, history, memory and machine state never enter native settings. */
function selectedSettings(harness: "claude-code" | "codex", raw: Record<string, unknown>, omitted: string[], legacy = false): Record<string, unknown> {
  const result = Object.fromEntries(Object.entries(raw).filter(([key]) => { const keep = keys[harness].includes(key) || (legacy && harness === "codex" && key === "mcp_servers"); if (!keep) omitted.push(key); return keep; }));
  if (result.mcp_servers) result.mcp_servers = Object.fromEntries(Object.entries(object(result.mcp_servers)).map(([name, server]) => {
    id.parse(name);
    const clean = Object.fromEntries(Object.entries(object(server)).filter(([key]) => {
      const keep = ["command", "args", "url", "enabled", "startup_timeout_sec", "tool_timeout_sec", "enabled_tools", "disabled_tools", "bearer_token_env_var", "env_vars"].includes(key);
      if (!keep) omitted.push(`mcp_servers.${name}.${key}`); return keep;
    }));
    if (clean.url) { const url = new URL(String(clean.url)); if (url.username || url.password || url.search || url.hash) throw new Error("MCP URLs must not contain credentials, query parameters, or fragments"); }
    return [name, clean];
  }));
  rejectSecrets("native-settings", Buffer.from(canonical(result))); return result;
}
export function sealNativeSetup(raw: Omit<NativeSetup, "revision">): NativeSetup {
  const body = nativeSetupBodySchema.parse(raw); validateFiles(body.files);
  const omitted: string[] = [];
  if (canonical(selectedSettings(body.harness.kind, body.settings, omitted, Boolean(body.settings.mcp_servers))) !== canonical(body.settings) || omitted.length) throw new Error("Native setup contains unsupported or local-only settings");
  if (body.mcpServers && (body.harness.kind !== "claude-code" || canonical(selectedMcp(body.mcpServers, omitted)) !== canonical(body.mcpServers) || omitted.length)) throw new Error("MCP definitions contain local-only settings");
  if (body.mcpServerNames && new Set(body.mcpServerNames).size !== body.mcpServerNames.length) throw new Error("Duplicate MCP server name");
  rejectSecrets("workflow.md", Buffer.from(body.workflow.prompt));
  rejectSecrets("setup-metadata", Buffer.from(canonical({ ...body, files: [] })));
  for (const path of body.instructions) { safePath(path); if (!body.files.some(f => f.path === path)) throw new Error(`Missing instruction file: ${path}`); }
  for (const path of Object.values(body.resources).flat()) { safePath(path); if (!body.files.some(f => f.path === path || f.path.startsWith(`${path}/`))) throw new Error(`Missing resource: ${path}`); }
  validateSkillPins(body.skillPins, body.files, body.scope, body.harness.kind, body.resources.skills);
  return { ...body, revision: digest(canonical(body)) };
}
export function validateSetup(raw: unknown): Setup {
  const setup = setupSchema.parse(raw);
  if (setup.schemaVersion === 1) return validateProfile(setup);
  const { revision, ...body } = setup;
  if (sealNativeSetup(body).revision !== revision) throw new Error("Setup revision does not match its contents");
  return setup;
}
export function getSetup(store: Store, ref: string): Setup {
  if (existsSync(ref) && lstatSync(ref).isFile()) return validateSetup(jsonRead(ref));
  id.parse(ref);
  const revision = /^[a-f0-9]{64}$/.test(ref) ? ref : (jsonRead(join(store.dir, "names", `${ref}.json`)) as { revision: string }).revision;
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error("Invalid setup revision");
  return validateSetup(jsonRead(join(store.dir, "profiles", `${revision}.json`)));
}
export function saveSetup(store: Store, raw: Setup, alias = raw.name): Setup {
  const setup = validateSetup(raw); id.parse(alias);
  if (setup.scope !== store.scope) throw new Error("Setup scope does not match this store");
  const path = join(store.dir, "profiles", `${setup.revision}.json`);
  if (!existsSync(path)) jsonWrite(path, setup);
  jsonWrite(join(store.dir, "names", `${alias}.json`), { revision: setup.revision }, true); return setup;
}
export function listSetups(store: Store) {
  const dir = join(store.dir, "names");
  return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(".json")).sort().map(f => ({ localName: f.slice(0, -5), setup: getSetup(store, f.slice(0, -5)) })) : [];
}
export function addSkillToSetup(setup: Setup, skill: Skill): Setup {
  validateSetup(setup);
  const harness = setupHarness(setup);
  if (setup.scope !== skill.scope) throw new Error("Skill and setup scopes must match");
  if (!skill.compatibleWith.includes(harness)) throw new Error(`Skill does not declare compatibility with ${harness}`);
  const path = `shared-skills/${skill.name}`; const old = setup.skillPins?.find(p => p.name === skill.name);
  // A same-named bundled skill would make version attribution ambiguous.
  if (setup.files.some(f => f.path.endsWith(`/${skill.name}/SKILL.md`) && (!old || !f.path.startsWith(`${old.path}/`)))) throw new Error("Setup already bundles this skill name; remove or rename the bundled copy first");
  const files = setup.files.filter(f => !old || !f.path.startsWith(`${old.path}/`));
  files.push(...skill.files.map(f => ({ ...f, path: `${path}/${f.path}` }))); files.sort((a, b) => a.path.localeCompare(b.path));
  const skillPins = [...(setup.skillPins ?? []).filter(p => p.name !== skill.name), makeSkillPin(skill, path)].sort((a, b) => a.name.localeCompare(b.name));
  const resources = { ...setup.resources, skills: [...setup.resources.skills.filter(p => p !== old?.path && p !== path), path] };
  const { revision, ...body } = setup;
  return body.schemaVersion === 1 ? sealProfile({ ...body, files, skillPins, resources: { ...body.resources, skills: resources.skills } }) : sealNativeSetup({ ...body, files, skillPins, resources: { ...body.resources, skills: resources.skills } });
}
export function captureSetup(options: { name: string; scope: "work" | "personal"; harness: Harness; agentDir?: string; project?: string; workflowId?: string; prompt?: string; model?: string; version?: string }): Setup {
  if (options.harness === "pi") return captureProfile({ ...options, agentDir: options.agentDir ?? nativeAgentDir("pi") });
  const harness = options.harness; const root = resolve(options.agentDir ?? nativeAgentDir(harness));
  if (!existsSync(root)) throw new Error(`Harness directory does not exist: ${root}`);
  const layers = [{ root, label: "global" }, ...(options.project ? [{ root: join(resolve(options.project), harness === "codex" ? ".codex" : ".claude"), label: "project" }] : [])];
  const body: Omit<NativeSetup, "revision"> = { schemaVersion: 2, kind: "setup", name: options.name, scope: options.scope,
    harness: { kind: harness, version: options.version ?? detectedVersion(harness) }, settings: {}, workflow: { id: options.workflowId ?? "pr-review", prompt: options.prompt ?? DEFAULT_NATIVE_REVIEW },
    resources: { skills: [], hooks: [], agents: [], prompts: [] }, instructions: [], requirements: [], omittedSettings: [], skillPins: [], files: [],
  };
  const skills = new Map<string, Skill>();
  const serverNames = new Set<string>();
  if (harness === "claude-code") {
    const sources = [join(root, ".mcp.json"), ...(root === resolve(nativeAgentDir("claude-code")) ? [join(homedir(), ".claude.json")] : []), ...(options.project ? [join(resolve(options.project), ".mcp.json")] : [])];
    for (const file of sources) if (existsSync(file)) { const raw = object(jsonRead(file)); if (raw.mcpServers) for (const name of mcpNames(raw.mcpServers)) serverNames.add(name); }
  }
  for (const layer of layers) {
    const config = join(layer.root, harness === "codex" ? "config.toml" : "settings.json");
    if (existsSync(config)) {
      const raw = object(harness === "codex" ? parseToml(readFileSync(config, "utf8")) : jsonRead(config));
      if (harness === "codex" && raw.mcp_servers) for (const name of mcpNames(raw.mcp_servers)) serverNames.add(name);
      body.settings = { ...body.settings, ...selectedSettings(harness, raw, body.omittedSettings) };
    }
    for (const kind of ["hooks", "agents", "prompts"] as const) {
      const dir = join(layer.root, kind); if (!existsSync(dir)) continue;
      const files = walk(dir, new Set([".git", "node_modules", "sessions", "memory", ".DS_Store"]));
      if (!files.length) continue;
      const dest = `${layer.label}/${kind}`; body.resources[kind].push(dest);
      body.files.push(...files.map(file => packFile(`${dest}/${relative(dir, file).split("\\").join("/")}`, readFileSync(file), Boolean(lstatSync(file).mode & 0o111))));
    }
    // Repository instructions and automatic memory belong to the local task.
    if (layer.label === "global") {
      const instruction = [harness === "codex" ? "AGENTS.override.md" : "CLAUDE.md", harness === "codex" ? "AGENTS.md" : "CLAUDE.md"].map(n => join(root, n)).find(existsSync);
      if (instruction) { const path = `global/${basename(instruction)}`; body.files.push(packFile(path, readFileSync(instruction))); body.instructions.push(path); }
    }
    const dirs = [join(layer.root, "skills")];
    if (harness === "codex") dirs.push(join(layer.label === "global" ? (root === resolve(nativeAgentDir("codex")) ? homedir() : dirname(root)) : resolve(options.project!), ".agents/skills"));
    for (const dir of new Set(dirs)) if (existsSync(dir)) for (const file of walk(dir, new Set([".git", "node_modules", "memory", "sessions", ".DS_Store"]))) if (basename(file) === "SKILL.md") {
      const skillDir = dirname(file); const hasReceipt = existsSync(join(skillDir, ".pi-share-skill.json"));
      try {
        const skill = captureSkill({ dir: skillDir, scope: options.scope, ...(hasReceipt ? {} : { compatibleWith: [harness] }) }); skills.set(skill.name, skill);
      } catch (error) {
        // Native harnesses may accept nonstandard frontmatter. Keep those files
        // native; malformed metadata must not imply cross-harness compatibility.
        if (!(error instanceof SkillMetadataError) || hasReceipt) throw error;
        const folder = relative(dir, skillDir).split("\\").join("/");
        const dest = `${layer.label}/skills${folder ? `/${folder}` : ""}`;
        const files = walk(skillDir, new Set([".git", "node_modules", "memory", "sessions", ".DS_Store", ".pi-share-skill.json"]));
        body.resources.skills.push(dest);
        body.files.push(...files.map(path => packFile(`${dest}/${relative(skillDir, path).split("\\").join("/")}`, readFileSync(path), Boolean(lstatSync(path).mode & 0o111))));
        body.requirements.push(`Review ${dest}: retained as a native skill without a standalone pin because its frontmatter is not portable.`);
      }
    }
  }
  if (options.model) body.settings.model = options.model;
  if (serverNames.size) body.mcpServerNames = [...serverNames].sort();
  for (const [name, skill] of skills) { const path = `shared-skills/${name}`; body.skillPins.push(makeSkillPin(skill, path)); body.resources.skills.push(path); body.files.push(...skill.files.map(f => ({ ...f, path: `${path}/${f.path}` }))); }
  body.omittedSettings = [...new Set(body.omittedSettings)].sort();
  if (body.settings.enabledPlugins) body.requirements.push("Install the declared plugins locally with their native plugin manager.");
  if (body.mcpServerNames?.length) body.requirements.push("Configure the named MCP servers locally; connection details and credentials are not included.");
  if (body.settings.hooks || body.resources.hooks.length) body.requirements.push("Review hook commands and resolve machine-specific paths before use.");
  body.files.sort((a, b) => a.path.localeCompare(b.path)); return sealNativeSetup(body);
}

/** Export a new native config directory. Never overwrite the receiver's default harness. */
export function materializeSetup(setup: Setup, dest: string) {
  validateSetup(setup); assertNoSymlinkAncestors(dest);
  if (setup.schemaVersion === 1) { unpack(setup.files, dest); return { directory: resolve(dest), harness: "pi" as const, instructions: "Use pi-share run with this setup and a local frozen packet." }; }
  const files = setup.files.map(f => ({ ...f }));
  const mapped = files.map(f => {
    const pin = setup.skillPins.find(p => f.path.startsWith(`${p.path}/`));
    if (pin) return { ...f, path: `skills/${pin.name}/${f.path.slice(pin.path.length + 1)}` };
    return { ...f, path: f.path.replace(/^(global|project)\//, "") };
  });
  // Project resource files override the same global resource path, matching native precedence.
  const unique = [...new Map(mapped.map(f => [f.path, f])).values()];
  const { mcp_servers: _legacyMcpServers, ...safeSettings } = setup.settings;
  const settings = setup.harness.kind === "codex" ? stringifyToml(safeSettings as Parameters<typeof stringifyToml>[0]) : JSON.stringify(safeSettings, null, 2);
  unique.push(packFile(setup.harness.kind === "codex" ? "config.toml" : "settings.json", Buffer.from(settings)));
  for (const pin of setup.skillPins) {
    const { path, ...meta } = pin;
    unique.push(packFile(`skills/${pin.name}/.pi-share-skill.json`, Buffer.from(JSON.stringify({ ...meta, scope: setup.scope, schemaVersion: 1, kind: "skill" }))));
  }
  unpack(unique, resolve(dest));
  writeFileSync(join(resolve(dest), "pi-share-setup.json"), JSON.stringify({ name: setup.name, revision: setup.revision, harness: setup.harness, skillPins: setup.skillPins.map(({ name, revision }) => ({ name, revision })) }, null, 2), { flag: "wx", mode: 0o600 });
  return { directory: resolve(dest), harness: setup.harness.kind, requirements: [...setup.requirements, ...setup.skillPins.flatMap(pin => pin.requirements.map(r => `${pin.name}: ${r}`))], instructions: `Use ${setup.harness.kind === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR"} to select this directory. Authenticate locally if needed; no account credentials are included.` };
}

export function setupMcpServerNames(setup: Setup): string[] {
  if (setup.schemaVersion === 1) return [];
  return [...new Set([...(setup.mcpServerNames ?? []), ...Object.keys(setup.mcpServers ?? {}), ...Object.keys(object(setup.settings.mcp_servers ?? {}))])].sort();
}

export function hasMcpDetails(setup: Setup): boolean {
  return setup.schemaVersion !== 1 && (setup.mcpServers !== undefined || setup.settings.mcp_servers !== undefined);
}
