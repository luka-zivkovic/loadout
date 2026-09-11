import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { digest } from "./files.js";
import { id, metricsSchema, type Metrics } from "./schema.js";

export type MetricIdentity = Pick<Metrics, "runId" | "comparisonId" | "scope" | "actorId" | "deviceId" | "profileName" | "profileRevision" | "effectiveConfigHash" | "contextHash" | "workflowId" | "mode" | "source" | "piVersion" | "toolPolicy" | "skillPins">;
type Event = { type: string; [key: string]: any };
const numeric = (v: unknown): number => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
const toolName = (value: string) => id.safeParse(value).success ? value : `tool-${digest(value).slice(0, 16)}`;

/** Events are consumed in memory. Only the explicit Metrics schema can leave this collector. */
export class Collector {
  private readonly started = Date.now();
  private readonly starts = new Map<string, { time: number; name: string; skill?: string }>();
  private readonly tools = new Map<string, Metrics["tools"][number]>();
  private readonly models = new Map<string, Metrics["models"][number]>();
  private readonly skills = new Map<string, string>();
  private readonly skillNames = new Map<string, string>();
  private readonly loaded = new Set<string>();
  private readonly incompleteCost = new Set<string>();
  private seenMessages = new WeakSet<object>();
  private turns = 0; private retries = 0; private compactions = 0;
  private error = false;
  constructor(readonly identity: MetricIdentity, private cwd: string, skillFiles: { path: string; name: string; hash: string }[] = []) {
    for (const skill of skillFiles) {
      const path = existsSync(skill.path) ? realpathSync(skill.path) : resolve(skill.path);
      this.skills.set(path, skill.hash); this.skillNames.set(toolName(skill.name), skill.hash);
    }
  }
  explicitSkill(prompt: string) {
    const name = /^\/skill:([^\s]+)/.exec(prompt)?.[1]; const value = name ? this.skillNames.get(name) : undefined;
    if (value) this.loaded.add(value);
  }
  observe(event: Event, thinking: Metrics["models"][number]["thinking"] = null) {
    if (event.type === "turn_start") this.turns++;
    if (event.type === "auto_retry_start") this.retries++;
    if (event.type === "compaction_end" && !event.aborted && event.result) this.compactions++;
    if (event.type === "session_compact") this.compactions++;
    if (event.type === "tool_execution_start") {
      const name = toolName(String(event.toolName));
      const tool = this.tools.get(name) ?? { name, calls: 0, errors: 0, completed: 0, totalDurationMs: 0 };
      tool.calls++; this.tools.set(name, tool);
      let skill: string | undefined;
      if (name === "read" && typeof event.args?.path === "string") {
        const path = resolve(this.cwd, event.args.path);
        skill = this.skills.get(existsSync(path) ? realpathSync(path) : path);
      }
      this.starts.set(String(event.toolCallId), { time: Date.now(), name, skill });
    }
    if (event.type === "tool_execution_end") {
      const start = this.starts.get(String(event.toolCallId));
      if (start) {
        const tool = this.tools.get(start.name)!; tool.completed++; tool.totalDurationMs += Math.max(0, Date.now() - start.time);
        if (event.isError) tool.errors++; else if (start.skill) this.loaded.add(start.skill);
        this.starts.delete(String(event.toolCallId));
      }
    }
    if (event.type === "message_end" && event.message?.role === "assistant") {
      const m = event.message;
      if (this.seenMessages.has(m)) return;
      this.seenMessages.add(m);
      this.error = m.stopReason === "error" || m.stopReason === "aborted";
      const provider = String(m.provider ?? "unknown").slice(0, 120); const model = String(m.model ?? "unknown").slice(0, 180);
      const key = `${provider}/${model}/${thinking}`;
      const row = this.models.get(key) ?? { provider, model, thinking, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: null, usageCalls: 0 };
      row.calls++;
      if (m.usage) {
        row.usageCalls++; row.inputTokens += numeric(m.usage.input); row.outputTokens += numeric(m.usage.output);
        row.cacheReadTokens += numeric(m.usage.cacheRead); row.cacheWriteTokens += numeric(m.usage.cacheWrite);
        if (typeof m.usage.cost?.total === "number" && Number.isFinite(m.usage.cost.total) && m.usage.cost.total >= 0) row.estimatedCostUsd = (row.estimatedCostUsd ?? 0) + m.usage.cost.total;
        else this.incompleteCost.add(key);
      } else this.incompleteCost.add(key);
      if (this.incompleteCost.has(key)) row.estimatedCostUsd = null;
      this.models.set(key, row);
    }
  }
  finish(status: Metrics["status"] = this.error ? "error" : "completed", failureCode?: Metrics["failureCode"]): Metrics {
    return metricsSchema.parse({ ...this.identity, schemaVersion: 1, startedAt: new Date(this.started).toISOString(),
      status, failureCode: failureCode ?? (status === "completed" ? "none" : status === "aborted" ? "aborted" : status === "timeout" ? "timeout" : "provider"), durationMs: Date.now() - this.started,
      turns: this.turns, retries: this.retries, compactions: this.compactions,
      models: [...this.models.values()].sort((a, b) => `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`)),
      tools: [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name)),
      skillsAvailable: [...new Set(this.skills.values())].sort(), skillsLoaded: [...this.loaded].sort(),
      skillCatalog: [...this.skillNames].map(([name, hash]) => ({ name, hash })).sort((a, b) => a.name.localeCompare(b.name)),
      skillObservation: "observed-file-reads-and-explicit-commands", outcome: null,
    });
  }
}
