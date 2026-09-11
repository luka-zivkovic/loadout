import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { canonical, ensureDir, jsonRead, jsonWrite } from "./files.js";
import { analyticsSchema, assessmentSchema, id, metricsSchema, scope as scopeSchema, type Metrics, type Assessment } from "./schema.js";
import { newAssessment, orderAssessments } from "./assessments.js";

export class Store {
  readonly dir: string;
  readonly scope: "work" | "personal";
  constructor(root = process.env.PI_SHARE_HOME ?? join(homedir(), ".pi-share"), scope = "personal") {
    this.scope = scopeSchema.parse(scope); this.dir = join(resolve(root), this.scope); ensureDir(this.dir);
  }
  identity(actor?: string): { actorId: string; deviceId: string } {
    const path = join(this.dir, "identity.json");
    if (!existsSync(path)) jsonWrite(path, { actorId: actor ? id.parse(actor) : randomUUID(), deviceId: randomUUID() });
    const value = z.object({ actorId: id, deviceId: z.uuid() }).strict().parse(jsonRead(path));
    return { ...value, actorId: actor ? id.parse(actor) : value.actorId };
  }
  setActor(actorId: string) {
    const identity = { ...this.identity(), actorId: id.parse(actorId) };
    jsonWrite(join(this.dir, "identity.json"), identity, true); return identity;
  }
  assessments(): Assessment[] {
    const dir = join(this.dir, "assessments");
    return existsSync(dir) ? orderAssessments(readdirSync(dir).filter(f => f.endsWith(".json")).map(f => assessmentSchema.parse(jsonRead(join(dir, f))))) : [];
  }
  mergeAssessments(events: Assessment[], records = this.records()) {
    const existing = this.assessments(); const known = new Set(existing.map(e => e.eventId));
    const runs = new Map(records.map(r => [r.runId, r]));
    const ordered = orderAssessments([...existing, ...events]);
    for (const e of ordered) if (runs.get(e.runId)?.status !== "completed") throw new Error("Assessments require a completed run");
    let added = 0;
    for (const e of ordered) if (!known.has(e.eventId)) { jsonWrite(join(this.dir, "assessments", `${e.eventId}.json`), e); added++; }
    return added;
  }
  score(runId: string, actorId: string, outcome: NonNullable<Metrics["outcome"]>) {
    const event = newAssessment(this.assessments(), runId, actorId, outcome); this.mergeAssessments([event]); return event;
  }
  writeMetrics(raw: unknown, overwrite = false): Metrics {
    const record = metricsSchema.parse(raw);
    if (record.scope !== this.scope) throw new Error("Analytics scope does not match the selected store");
    jsonWrite(join(this.dir, "analytics", `${record.runId}.json`), record, overwrite); return record;
  }
  records(): Metrics[] {
    const dir = join(this.dir, "analytics");
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(f => f.endsWith(".json")).sort().map(f => metricsSchema.parse(jsonRead(join(dir, f))));
  }
  exportAnalytics(path: string) {
    const bundle = analyticsSchema.parse({ schemaVersion: 2, scope: this.scope, records: this.records(), assessments: this.assessments() });
    jsonWrite(path, bundle); return bundle.records.length;
  }
  importAnalytics(path: string) {
    const bundle = analyticsSchema.parse(jsonRead(path));
    if (bundle.scope !== this.scope || bundle.records.some(r => r.scope !== this.scope)) throw new Error("Refusing to mix personal and work analytics");
    const current = new Map(this.records().map(r => [r.runId, canonical(r)]));
    const seen = new Map<string, string>();
    for (const record of bundle.records) {
      const text = canonical(record); const previous = seen.get(record.runId) ?? current.get(record.runId);
      if (previous && previous !== text) throw new Error(`Conflicting record ${record.runId}; imported records never overwrite local results`);
      seen.set(record.runId, text);
    }
    const events = bundle.schemaVersion === 2 ? bundle.assessments : [];
    // Validate the complete batch before persisting either its runs or its edit history.
    const allEvents = orderAssessments([...this.assessments(), ...events]);
    const allRuns = new Map([...this.records(), ...bundle.records].map(r => [r.runId, r]));
    for (const e of allEvents) if (allRuns.get(e.runId)?.status !== "completed") throw new Error("Assessments require a completed run");
    let added = 0;
    for (const record of bundle.records) if (!current.has(record.runId)) { this.writeMetrics(record); current.set(record.runId, canonical(record)); added++; }
    this.mergeAssessments(events);
    return added;
  }
}
