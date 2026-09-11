import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { copyPacket, validatePacket } from "./context.js";
import { digest, ensureDir, jsonWrite } from "./files.js";
import { Collector } from "./metrics.js";
import {
  metricsSchema,
  type Assessment,
  type Metrics,
  type Profile,
} from "./schema.js";
import { assessmentHeads } from "./assessments.js";
import type { Store } from "./store.js";
import type { WorkerRequest } from "./worker.js";
import { assertLocalAvailable } from "./availability.js";

export interface RunOptions {
  store: Store;
  profile: Profile;
  packet: string;
  authDir?: string;
  actor?: string;
  timeoutSeconds?: number;
  modelOverride?: string;
  comparisonId?: string;
  demoUrl?: string;
  toolPolicy?: "profile" | "read-only";
}
export async function runProfile(options: RunOptions): Promise<Metrics> {
  assertLocalAvailable(options.store, options.profile);
  if (options.profile.scope !== options.store.scope)
    throw new Error("Profile and analytics scopes must match");
  const packet = validatePacket(resolve(options.packet));
  const runId = randomUUID();
  const runDir = join(options.store.dir, "runs", runId);
  ensureDir(runDir);
  const workspace = join(runDir, "workspace");
  copyPacket(resolve(options.packet), workspace);
  jsonWrite(join(runDir, "profile.json"), options.profile);
  const identity = {
    runId,
    comparisonId: options.comparisonId ?? null,
    scope: options.store.scope,
    ...options.store.identity(options.actor),
    profileName: options.profile.name,
    profileRevision: options.profile.revision,
    effectiveConfigHash: digest("setup-not-completed"),
    contextHash: packet.contextHash,
    workflowId: options.profile.workflow.id,
    mode: options.demoUrl ? ("demo" as const) : ("live" as const),
    source: "runner" as const,
    piVersion: options.profile.piVersion,
    toolPolicy: options.toolPolicy ?? ("profile" as const),
    ...(options.profile.skillPins
      ? {
          skillPins: options.profile.skillPins.map(({ name, revision }) => ({
            name,
            revision,
          })),
        }
      : {}),
  };
  const request: WorkerRequest = {
    profilePath: join(runDir, "profile.json"),
    packetPath: resolve(options.packet),
    runDir,
    authDir: resolve(
      options.authDir ??
        process.env.PI_CODING_AGENT_DIR ??
        join(homedir(), ".pi/agent"),
    ),
    identity,
    toolPolicy: options.toolPolicy ?? "profile",
    timeoutSeconds: options.timeoutSeconds ?? 180,
    ...(options.modelOverride ? { modelOverride: options.modelOverride } : {}),
    ...(options.demoUrl
      ? { demoUrl: options.demoUrl, thinkingOverride: "off" as const }
      : {}),
  };
  jsonWrite(join(runDir, "request.json"), request);
  jsonWrite(join(runDir, "run.json"), {
    schemaVersion: 1,
    runId,
    contextHash: packet.contextHash,
    profileRevision: options.profile.revision,
    nodeVersion: process.version,
    toolPolicy: request.toolPolicy,
    modelOverride: options.modelOverride ?? null,
    freshSession: true,
    ambientDiscovery: false,
  });
  const fallback = new Collector(identity, workspace);
  let latest = fallback.finish("aborted", "aborted");
  const result = await new Promise<Metrics>((done) => {
    const child = fork(
      fileURLToPath(new URL("./worker.js", import.meta.url)),
      ["--request", join(runDir, "request.json")],
      {
        cwd: workspace,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        execArgv: [],
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: join(runDir, "config"),
          PI_SHARE_DISABLED: "1",
        },
      },
    );
    let final: Metrics | undefined;
    let timeout = false;
    let settled = false;
    let setupFailed = false;
    let interrupted = false;
    const finish = (record: Metrics) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      done(record);
    };
    const interrupt = () => {
      interrupted = true;
      child.kill("SIGKILL");
    };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    const timer = setTimeout(
      () => {
        timeout = true;
        child.kill("SIGKILL");
      },
      (request.timeoutSeconds + 45) * 1000,
    );
    child.on("message", (message: any) => {
      if (message.type === "failed") setupFailed = true;
      if (message.type === "metrics" || message.type === "done") {
        const parsed = metricsSchema.safeParse(message.metrics);
        if (parsed.success && parsed.data.runId === runId) {
          latest = parsed.data;
          if (message.type === "done") final = parsed.data;
        }
      }
    });
    child.once("error", () =>
      finish({ ...latest, status: "error", failureCode: "worker_failed" }),
    );
    child.once("exit", () =>
      finish(
        final ?? {
          ...latest,
          status: interrupted ? "aborted" : timeout ? "timeout" : "error",
          failureCode: interrupted
            ? "aborted"
            : timeout
              ? "timeout"
              : setupFailed
                ? "setup"
                : "worker_failed",
        },
      ),
    );
  });
  jsonWrite(join(runDir, "metrics.json"), result, true);
  options.store.writeMetrics(result);
  return result;
}

export function formatReport(
  records: Metrics[],
  assessments: Assessment[] = [],
): string {
  const currentAssessments = assessmentHeads(assessments);
  const lines = [
    "# Harness setup comparison",
    "",
    "Estimates describe model usage, not subscription invoices. Unscored reviews have no quality ranking.",
    "",
    "| Setup | Mode | Status | Turns | Tools | Skills loaded | Input / output tokens | Estimated USD | Duration | Human score (valid / false / missed) |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---|",
  ];
  for (const r of records) {
    const value = (key: keyof NonNullable<Metrics["coverage"]>, n: number) =>
      r.coverage?.[key] === "unavailable" ? "unknown" : n;
    const input = r.models.reduce(
      (n, m) => n + m.inputTokens + m.cacheReadTokens + m.cacheWriteTokens,
      0,
    );
    const output = r.models.reduce((n, m) => n + m.outputTokens, 0);
    const cost =
      r.models.length && r.models.every((m) => m.estimatedCostUsd !== null)
        ? r.models.reduce((n, m) => n + m.estimatedCostUsd!, 0).toFixed(6)
        : "unknown";
    const current = currentAssessments.filter((e) => e.runId === r.runId);
    const outcome = current.length === 1 ? current[0]!.outcome : r.outcome;
    const score =
      current.length > 1
        ? "see assessments"
        : outcome
          ? `${outcome.validFindings} / ${outcome.falsePositives} / ${outcome.missedKnownIssues}`
          : "unscored";
    lines.push(
      `| ${r.profileName} · ${r.harness?.kind ?? "pi"} · ${r.profileRevision.slice(0, 8)} | ${r.mode} | ${r.status} | ${value("turns", r.turns)} | ${value(
        "tools",
        r.tools.reduce((n, t) => n + t.calls, 0),
      )} | ${value("skills", r.skillsLoaded.length)} | ${value("tokens", input)} / ${value("tokens", output)} | ${cost} | ${(r.durationMs / 1000).toFixed(1)}s | ${score} |`,
    );
  }
  lines.push("", "Configuration identity and context:", "");
  for (const r of records) {
    lines.push(
      `- ${r.profileName}: run ${r.runId}; effective configuration ${r.effectiveConfigHash}; context ${r.contextHash}; tool policy ${r.toolPolicy}.`,
    );
    lines.push(
      `  Tools: ${r.tools.map((t) => `${t.name} (${t.calls} calls, ${t.errors} errors)`).join(", ") || "none"}. Skills observed loading: ${
        r.skillCatalog
          .filter((s) => r.skillsLoaded.includes(s.hash))
          .map((s) => s.name)
          .join(", ") || "none"
      }.`,
    );
  }
  if (new Set(records.map((r) => r.contextHash)).size > 1)
    lines.push(
      "",
      "Different context packets: these runs are not a controlled comparison.",
    );
  if (records.some((r) => r.source === "telemetry"))
    lines.push(
      "",
      "Native telemetry records describe observed intervals, not verified completed tasks. Selected setup revisions are attribution labels; effective configurations, skill versions actually loaded, and task context are unverified.",
    );
  if (new Set(records.map((r) => r.mode)).size > 1)
    lines.push(
      "",
      "Demo and live runs are different evidence and must not be ranked together.",
    );
  const included = new Set(records.map((r) => r.runId));
  const heads = currentAssessments.filter((e) => included.has(e.runId));
  if (heads.length) {
    lines.push(
      "",
      "## Versioned human assessments",
      "",
      "Multiple current versions for the same run and reviewer are a conflict. Sync, then score again to resolve them explicitly.",
      "",
      "| Run | Reviewer | Valid | False | Missed | Current versions |",
      "|---|---|---:|---:|---:|---:|",
    );
    for (const e of heads)
      lines.push(
        `| ${e.runId} | ${e.actorId} | ${e.outcome.validFindings} | ${e.outcome.falsePositives} | ${e.outcome.missedKnownIssues} | ${heads.filter((h) => h.runId === e.runId && h.actorId === e.actorId).length} |`,
      );
  }
  return `${lines.join("\n")}\n`;
}
export async function compareProfiles(
  options: Omit<RunOptions, "profile"> & {
    profiles: Profile[];
    repeats?: number;
  },
): Promise<{ comparisonId: string; records: Metrics[]; report: string }> {
  if (options.profiles.length < 2)
    throw new Error("Choose at least two profiles");
  if (options.profiles.some((p) => p.scope !== options.store.scope))
    throw new Error("All profile and analytics scopes must match");
  if (new Set(options.profiles.map((p) => p.workflow.id)).size !== 1)
    throw new Error("Compared profiles must declare the same workflow ID");
  const comparisonId = options.comparisonId ?? randomUUID();
  const records: Metrics[] = [];
  const dir = join(options.store.dir, "comparisons", comparisonId);
  ensureDir(dir);
  for (let repeat = 0; repeat < (options.repeats ?? 1); repeat++) {
    // Alternate order on repeats to reduce a consistent first-run/cache advantage.
    for (const profile of repeat % 2
      ? [...options.profiles].reverse()
      : options.profiles) {
      process.stderr.write(`Review ${repeat + 1}: ${profile.name}\n`);
      records.push(await runProfile({ ...options, profile, comparisonId }));
      jsonWrite(
        join(dir, "comparison.json"),
        { schemaVersion: 1, comparisonId, runIds: records.map((r) => r.runId) },
        true,
      );
      writeFileSync(join(dir, "report.md"), formatReport(records), {
        mode: 0o600,
      });
      if (records.at(-1)?.status === "aborted") break;
    }
    if (records.at(-1)?.status === "aborted") break;
  }
  return { comparisonId, records, report: join(dir, "report.md") };
}
