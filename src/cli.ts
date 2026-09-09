#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { freezeContext } from "./context.js";
import { runDemo } from "./demo.js";
import { ensureDir, jsonRead, jsonWrite } from "./files.js";
import { captureProfile, exampleProfile, getProfile, listProfiles, saveProfile, validateProfile } from "./profiles.js";
import { compareProfiles, formatReport, runProfile } from "./runner.js";
import { Store } from "./store.js";

const help = `Pi Share — portable Pi profiles and metadata-only analytics

  profile init NAME --model PROVIDER/MODEL [--thorough]
  profile capture NAME [--agent-dir DIR] [--project REPO] [--model PROVIDER/MODEL]
                       [--workflow ID] [--prompt FILE]
  profile list | show NAME
  profile export NAME --out FILE
  profile import FILE
  freeze --repo REPO --base REF --head REF --out DIR [--context DIR]
  run NAME --packet DIR [--model PROVIDER/MODEL] [--timeout SECONDS]
  compare --profiles NAME,NAME --packet DIR [--model PROVIDER/MODEL] [--repeat N]
  score RUN_ID --valid N --false N --missed N
  analytics export --out FILE
  analytics import FILE
  analytics report [--comparison UUID] [--include-demo] [--out FILE]
  demo [--out DIR]        Real Pi + scripted local provider; no paid model calls

Global: --home DIR (default ~/.pi-share), --scope personal|work (default personal),
        --actor ID (use the same ID across your devices), --auth-dir DIR

Comparison runs use fresh in-memory Pi sessions and the profile's tools.
Use --tool-policy read-only to fix the tool surface to read/grep/find/ls.
Profile extensions remain trusted executable code. Review outputs stay local.
Exports contain profile files or a strict metadata schema; never raw session events.
`;
const { values: v, positionals: p } = parseArgs({ allowPositionals: true, options: {
  help: { type: "boolean", short: "h" }, home: { type: "string" }, scope: { type: "string" }, actor: { type: "string" },
  model: { type: "string" }, "agent-dir": { type: "string" }, "auth-dir": { type: "string" }, project: { type: "string" },
  workflow: { type: "string" }, prompt: { type: "string" }, out: { type: "string" }, repo: { type: "string" },
  base: { type: "string" }, head: { type: "string" }, context: { type: "string" }, packet: { type: "string" },
  profiles: { type: "string" }, repeat: { type: "string" }, timeout: { type: "string" }, thorough: { type: "boolean" },
  valid: { type: "string" }, false: { type: "string" }, missed: { type: "string" }, comparison: { type: "string" }, "include-demo": { type: "boolean" },
  "tool-policy": { type: "string" },
} });
const need = (value: string | undefined, name: string) => { if (!value) throw new Error(`Missing ${name}; see --help`); return value; };
const number = (value: string | undefined, fallback: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).parse(value ?? fallback);
const summary = (profile: ReturnType<typeof getProfile>) => ({ name: profile.name, revision: profile.revision, scope: profile.scope,
  piVersion: profile.piVersion, settings: profile.settings, workflowId: profile.workflow.id, packages: profile.packages,
  resources: profile.resources, files: profile.files.map(f => ({ path: f.path, sha256: f.sha256 })),
  requirements: profile.requirements, omittedSettings: profile.omittedSettings,
});

async function main() {
  if (v.help || !p.length) { console.log(help); return; }
  if (p[0] === "demo") {
    const result = await runDemo(v.out ? resolve(v.out) : undefined);
    console.log(`Demo comparison: ${result.report}\nMetadata export: ${join(result.out, "metadata.json")}`);
    if (result.records.some(r => r.status !== "completed")) process.exitCode = 1;
    return;
  }
  const store = new Store(v.home, v.scope ?? "personal");
  if (p[0] === "profile") {
    if (p[1] === "list") { console.log(JSON.stringify(listProfiles(store).map(summary), null, 2)); return; }
    if (p[1] === "init") {
      const profile = saveProfile(store, exampleProfile(need(p[2], "NAME"), store.scope, need(v.model, "--model"), v.thorough));
      console.log(JSON.stringify(summary(profile), null, 2)); return;
    }
    if (p[1] === "capture") {
      const profile = saveProfile(store, captureProfile({ name: need(p[2], "NAME"), scope: store.scope,
        agentDir: v["agent-dir"] ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent"), project: v.project,
        workflowId: v.workflow, prompt: v.prompt ? readFileSync(v.prompt, "utf8") : undefined, model: v.model,
      }));
      console.log(JSON.stringify(summary(profile), null, 2)); return;
    }
    if (p[1] === "import") {
      const profile = saveProfile(store, validateProfile(jsonRead(need(p[2], "FILE"))));
      console.log(`Imported ${profile.name}@${profile.revision}`); return;
    }
    const profile = getProfile(store, need(p[2], "NAME"));
    if (p[1] === "show") { console.log(JSON.stringify(summary(profile), null, 2)); return; }
    if (p[1] === "export") { jsonWrite(need(v.out, "--out"), profile); console.log(`Exported ${profile.name}@${profile.revision}`); return; }
  }
  if (p[0] === "freeze") {
    const packet = freezeContext({ repo: need(v.repo, "--repo"), base: need(v.base, "--base"), head: need(v.head, "--head"), out: need(v.out, "--out"), context: v.context });
    console.log(`Frozen context ${packet.contextHash}\n${resolve(v.out!)}`); return;
  }
  const runOptions = { store, packet: v.packet ?? "", actor: v.actor, authDir: v["auth-dir"],
    modelOverride: v.model, timeoutSeconds: number(v.timeout, 180, 1, 3600),
    toolPolicy: z.enum(["profile", "read-only"]).parse(v["tool-policy"] ?? "profile"),
  };
  if (p[0] === "run") {
    need(v.packet, "--packet"); const record = await runProfile({ ...runOptions, profile: getProfile(store, need(p[1], "NAME")) });
    console.log(formatReport([record])); console.log(`Local review: ${join(store.dir, "runs", record.runId, "review.md")}`);
    if (record.status !== "completed") process.exitCode = 1;
    return;
  }
  if (p[0] === "compare") {
    need(v.packet, "--packet"); const profiles = need(v.profiles, "--profiles").split(",").map(ref => getProfile(store, ref));
    const result = await compareProfiles({ ...runOptions, profiles, repeats: number(v.repeat, 1, 1, 20) });
    console.log(formatReport(result.records)); console.log(`Report: ${result.report}`);
    if (result.records.some(r => r.status !== "completed")) process.exitCode = 1;
    return;
  }
  if (p[0] === "score") {
    const runId = z.uuid().parse(need(p[1], "RUN_ID")); const record = store.records().find(r => r.runId === runId);
    if (!record || record.status !== "completed") throw new Error("Score only a completed local/imported run");
    record.outcome = { validFindings: number(need(v.valid, "--valid"), 0, 0, 10000), falsePositives: number(need(v.false, "--false"), 0, 0, 10000),
      missedKnownIssues: number(need(v.missed, "--missed"), 0, 0, 10000), evaluator: "human" };
    store.writeMetrics(record, true); console.log(`Scored ${runId}. Regenerate analytics report to include this score.`); return;
  }
  if (p[0] === "analytics") {
    if (p[1] === "export") { console.log(`Exported ${store.exportAnalytics(need(v.out, "--out"))} metadata records`); return; }
    if (p[1] === "import") { console.log(`Imported ${store.importAnalytics(need(p[2], "FILE"))} new metadata records`); return; }
    if (p[1] === "report") {
      const records = store.records().filter(r => (v["include-demo"] || r.mode === "live") && (!v.comparison || r.comparisonId === v.comparison));
      const report = formatReport(records);
      if (v.out) { jsonWriteGuard(v.out); writeFileSync(v.out, report, { mode: 0o600, flag: "wx" }); console.log(resolve(v.out)); } else console.log(report);
      return;
    }
  }
  throw new Error("Unknown command; see --help");
}
function jsonWriteGuard(path: string) { ensureDir(resolve(path, "..")); }
main().catch(error => { console.error(`pi-share: ${error instanceof Error ? error.message : "Operation failed"}`); process.exitCode = 1; });
