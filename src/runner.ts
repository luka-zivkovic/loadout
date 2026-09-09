import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { copyPacket, validatePacket } from "./context.js";
import { digest, ensureDir, jsonWrite } from "./files.js";
import { Collector } from "./metrics.js";
import { metricsSchema, type Metrics, type Profile } from "./schema.js";
import type { Store } from "./store.js";
import type { WorkerRequest } from "./worker.js";

export interface RunOptions {
  store: Store; profile: Profile; packet: string; authDir?: string; actor?: string;
  timeoutSeconds?: number; modelOverride?: string; comparisonId?: string; demoUrl?: string;
  toolPolicy?: "profile" | "read-only";
}
export async function runProfile(options: RunOptions): Promise<Metrics> {
  if (options.profile.scope !== options.store.scope) throw new Error("Profile and analytics scopes must match");
  const packet = validatePacket(resolve(options.packet)); const runId = randomUUID();
  const runDir = join(options.store.dir, "runs", runId); ensureDir(runDir);
  const workspace = join(runDir, "workspace"); copyPacket(resolve(options.packet), workspace);
  jsonWrite(join(runDir, "profile.json"), options.profile);
  const identity = {
    runId, comparisonId: options.comparisonId ?? null, scope: options.store.scope, ...options.store.identity(options.actor),
    profileName: options.profile.name, profileRevision: options.profile.revision, effectiveConfigHash: digest("setup-not-completed"),
    contextHash: packet.contextHash, workflowId: options.profile.workflow.id, mode: options.demoUrl ? "demo" as const : "live" as const,
    source: "runner" as const, piVersion: options.profile.piVersion, toolPolicy: options.toolPolicy ?? "profile" as const,
  };
  const request: WorkerRequest = {
    profilePath: join(runDir, "profile.json"), packetPath: resolve(options.packet), runDir,
    authDir: resolve(options.authDir ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent")),
    identity, toolPolicy: options.toolPolicy ?? "profile", timeoutSeconds: options.timeoutSeconds ?? 180, ...(options.modelOverride ? { modelOverride: options.modelOverride } : {}),
    ...(options.demoUrl ? { demoUrl: options.demoUrl, thinkingOverride: "off" as const } : {}),
  };
  jsonWrite(join(runDir, "request.json"), request);
  jsonWrite(join(runDir, "run.json"), { schemaVersion: 1, runId, contextHash: packet.contextHash, profileRevision: options.profile.revision,
    nodeVersion: process.version, toolPolicy: request.toolPolicy,
    modelOverride: options.modelOverride ?? null, freshSession: true, ambientDiscovery: false,
  });
  const fallback = new Collector(identity, workspace);
  let latest = fallback.finish("aborted", "aborted");
  const result = await new Promise<Metrics>((done) => {
    const child = fork(fileURLToPath(new URL("./worker.js", import.meta.url)), ["--request", join(runDir, "request.json")], {
      cwd: workspace, stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: [],
      env: { ...process.env, PI_CODING_AGENT_DIR: join(runDir, "config"), PI_SHARE_DISABLED: "1" },
    });
    let final: Metrics | undefined; let timeout = false; let settled = false; let setupFailed = false; let interrupted = false;
    const finish = (record: Metrics) => {
      if (settled) return; settled = true; clearTimeout(timer); process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
      done(record);
    };
    const interrupt = () => { interrupted = true; child.kill("SIGKILL"); };
    process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
    const timer = setTimeout(() => { timeout = true; child.kill("SIGKILL"); }, (request.timeoutSeconds + 45) * 1000);
    child.on("message", (message: any) => {
      if (message.type === "failed") setupFailed = true;
      if (message.type === "metrics" || message.type === "done") {
        const parsed = metricsSchema.safeParse(message.metrics);
        if (parsed.success && parsed.data.runId === runId) { latest = parsed.data; if (message.type === "done") final = parsed.data; }
      }
    });
    child.once("error", () => finish({ ...latest, status: "error", failureCode: "worker_failed" }));
    child.once("exit", () => finish(final ?? { ...latest, status: interrupted ? "aborted" : timeout ? "timeout" : "error", failureCode: interrupted ? "aborted" : timeout ? "timeout" : setupFailed ? "setup" : "worker_failed" }));
  });
  jsonWrite(join(runDir, "metrics.json"), result, true); options.store.writeMetrics(result);
  return result;
}

export function formatReport(records: Metrics[]): string {
  const lines = ["# Pi setup comparison", "", "Estimates describe model usage, not subscription invoices. Unscored reviews have no quality ranking.", "",
    "| Setup | Mode | Status | Turns | Tools | Skills loaded | Input / output tokens | Estimated USD | Duration | Human score (valid / false / missed) |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---|",
  ];
  for (const r of records) {
    const input = r.models.reduce((n, m) => n + m.inputTokens + m.cacheReadTokens + m.cacheWriteTokens, 0);
    const output = r.models.reduce((n, m) => n + m.outputTokens, 0);
    const cost = r.models.length && r.models.every(m => m.estimatedCostUsd !== null) ? r.models.reduce((n, m) => n + m.estimatedCostUsd!, 0).toFixed(6) : "unknown";
    const score = r.outcome ? `${r.outcome.validFindings} / ${r.outcome.falsePositives} / ${r.outcome.missedKnownIssues}` : "unscored";
    lines.push(`| ${r.profileName} · ${r.profileRevision.slice(0, 8)} | ${r.mode} | ${r.status} | ${r.turns} | ${r.tools.reduce((n, t) => n + t.calls, 0)} | ${r.skillsLoaded.length} | ${input} / ${output} | ${cost} | ${(r.durationMs / 1000).toFixed(1)}s | ${score} |`);
  }
  lines.push("", "Configuration identity and context:", "");
  for (const r of records) {
    lines.push(`- ${r.profileName}: run ${r.runId}; effective configuration ${r.effectiveConfigHash}; context ${r.contextHash}; tool policy ${r.toolPolicy}.`);
    lines.push(`  Tools: ${r.tools.map(t => `${t.name} (${t.calls} calls, ${t.errors} errors)`).join(", ") || "none"}. Skills observed loading: ${r.skillCatalog.filter(s => r.skillsLoaded.includes(s.hash)).map(s => s.name).join(", ") || "none"}.`);
  }
  if (new Set(records.map(r => r.contextHash)).size > 1) lines.push("", "Different context packets: these runs are not a controlled comparison.");
  if (new Set(records.map(r => r.mode)).size > 1) lines.push("", "Demo and live runs are different evidence and must not be ranked together.");
  return `${lines.join("\n")}\n`;
}
export async function compareProfiles(options: Omit<RunOptions, "profile" | "comparisonId"> & { profiles: Profile[]; repeats?: number }): Promise<{ comparisonId: string; records: Metrics[]; report: string }> {
  if (options.profiles.length < 2) throw new Error("Choose at least two profiles");
  if (options.profiles.some(p => p.scope !== options.store.scope)) throw new Error("All profile and analytics scopes must match");
  if (new Set(options.profiles.map(p => p.workflow.id)).size !== 1) throw new Error("Compared profiles must declare the same workflow ID");
  const comparisonId = randomUUID(); const records: Metrics[] = []; const dir = join(options.store.dir, "comparisons", comparisonId); ensureDir(dir);
  for (let repeat = 0; repeat < (options.repeats ?? 1); repeat++) {
    // Alternate order on repeats to reduce a consistent first-run/cache advantage.
    for (const profile of repeat % 2 ? [...options.profiles].reverse() : options.profiles) {
      process.stderr.write(`Review ${repeat + 1}: ${profile.name}\n`);
      records.push(await runProfile({ ...options, profile, comparisonId }));
      jsonWrite(join(dir, "comparison.json"), { schemaVersion: 1, comparisonId, runIds: records.map(r => r.runId) }, true);
      writeFileSync(join(dir, "report.md"), formatReport(records), { mode: 0o600 });
      if (records.at(-1)?.status === "aborted") break;
    }
    if (records.at(-1)?.status === "aborted") break;
  }
  return { comparisonId, records, report: join(dir, "report.md") };
}
