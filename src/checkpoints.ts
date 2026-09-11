import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { jsonRead, jsonWrite } from "./files.js";
import type { Store } from "./store.js";
import type { Metrics } from "./schema.js";
const leaseSchema = z
  .object({
    pid: z.number().int().positive(),
    state: z.enum(["collecting", "stopped", "interrupted"]),
    updatedAt: z.iso.datetime(),
    runIds: z.array(z.uuid()),
  })
  .strict();
export function collectorLeases(store: Store) {
  const dir = join(store.dir, "collectors");
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({
          path: join(dir, f),
          lease: leaseSchema.parse(jsonRead(join(dir, f))),
        }))
    : [];
}
export class TelemetryCheckpoint {
  readonly path: string;
  constructor(readonly store: Store) {
    this.path = join(store.dir, "collectors", `${randomUUID()}.json`);
  }
  save(records: Metrics[], state: "collecting" | "stopped" = "collecting") {
    for (const record of records)
      this.store.writeMetrics({ ...record, collectionState: state }, true);
    jsonWrite(
      this.path,
      {
        pid: process.pid,
        state,
        updatedAt: new Date().toISOString(),
        runIds: records.map((r) => r.runId),
      },
      true,
    );
  }
}
export function recoverTelemetry(store: Store) {
  let recovered = 0;
  const records = new Map(store.records().map((r) => [r.runId, r]));
  for (const { path, lease } of collectorLeases(store)) {
    if (lease.state !== "collecting") continue;
    try {
      process.kill(lease.pid, 0);
      continue;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ESRCH") continue;
    }
    for (const runId of lease.runIds) {
      const record = records.get(runId);
      if (record?.collectionState === "collecting") {
        store.writeMetrics({ ...record, collectionState: "interrupted" }, true);
        recovered++;
      }
    }
    jsonWrite(
      path,
      { ...lease, state: "interrupted", updatedAt: new Date().toISOString() },
      true,
    );
  }
  return {
    recovered,
    note: "Recovered counters are marked interrupted. Raw events and task content were not stored.",
  };
}
