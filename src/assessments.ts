import { randomUUID } from "node:crypto";
import { assessmentSchema, type Assessment, type Metrics } from "./schema.js";
import { canonical } from "./files.js";

/** Edits form a DAG. Concurrent leaves are a visible conflict, never a timestamp-based winner. */
export function assessmentHeads(events: Assessment[]): Assessment[] {
  const superseded = new Set(events.flatMap(e => e.parents));
  return events.filter(e => !superseded.has(e.eventId)).sort((a, b) => a.eventId.localeCompare(b.eventId));
}
export function orderAssessments(events: Assessment[]): Assessment[] {
  const byId = new Map<string, Assessment>();
  for (const raw of events) {
    const e = assessmentSchema.parse(raw); const old = byId.get(e.eventId);
    if (old && canonical(old) !== canonical(e)) throw new Error(`Conflicting assessment ${e.eventId}`);
    if (new Set(e.parents).size !== e.parents.length) throw new Error("Duplicate assessment parent");
    byId.set(e.eventId, e);
  }
  const children = new Map<string, string[]>(); const remaining = new Map<string, number>();
  const ordered: Assessment[] = [];
  for (const e of byId.values()) {
    remaining.set(e.eventId, e.parents.length);
    for (const parent of e.parents) {
      const p = byId.get(parent);
      if (!p || p.runId !== e.runId || p.actorId !== e.actorId) throw new Error("Assessment parent must refer to the same run and reviewer");
      children.set(parent, [...(children.get(parent) ?? []), e.eventId]);
    }
    if (!e.parents.length) ordered.push(e);
  }
  for (let i = 0; i < ordered.length; i++) for (const child of children.get(ordered[i]!.eventId) ?? []) {
    const count = remaining.get(child)! - 1; remaining.set(child, count);
    if (count === 0) ordered.push(byId.get(child)!);
  }
  if (ordered.length !== byId.size) throw new Error("Assessment history contains a cycle");
  return ordered;
}
export function newAssessment(events: Assessment[], runId: string, actorId: string, outcome: NonNullable<Metrics["outcome"]>): Assessment {
  return assessmentSchema.parse({ schemaVersion: 1, eventId: randomUUID(), runId, actorId,
    parents: assessmentHeads(events.filter(e => e.runId === runId && e.actorId === actorId)).map(e => e.eventId),
    createdAt: new Date().toISOString(), outcome,
  });
}
export function assessmentConflicts(events: Assessment[]) {
  const groups = new Map<string, Assessment[]>();
  for (const event of assessmentHeads(events)) {
    const key = `${event.runId}/${event.actorId}`; groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.values()].filter(heads => heads.length > 1).map(heads => ({ runId: heads[0]!.runId, actorId: heads[0]!.actorId, eventIds: heads.map(e => e.eventId) }));
}
