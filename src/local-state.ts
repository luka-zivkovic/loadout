import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { jsonRead, jsonWrite } from "./files.js";
import { captureSetup, listSetups, nativeAgentDir } from "./setups.js";
import { setupHarnessSchema, id, hash } from "./schema.js";
import type { Store } from "./store.js";
import { collectorLeases } from "./checkpoints.js";

const optionsSchema = z.object({
  name: id,
  scope: z.enum(["work", "personal"]),
  harness: setupHarnessSchema,
  agentDir: z.string().optional(),
  project: z.string().optional(),
  workflowId: z.string().optional(),
  prompt: z.string().optional(),
  promptFile: z.string().optional(),
  model: z.string().optional(),
  version: z.string().optional(),
});
const sourcesSchema = z.record(
  id,
  z.object({
    options: optionsSchema,
    revision: hash,
    capturedAt: z.iso.datetime(),
    checkedAt: z.iso.datetime(),
    changed: z.boolean(),
    error: z.boolean().default(false),
  }),
);
export function sources(store: Store) {
  const path = join(store.dir, "capture-sources.json");
  return existsSync(path) ? sourcesSchema.parse(jsonRead(path)) : {};
}
export function rememberCapture(
  store: Store,
  options: z.infer<typeof optionsSchema>,
  revision: string,
) {
  const all = sources(store);
  const now = new Date().toISOString();
  all[options.name] = {
    options: optionsSchema.parse({
      ...options,
      agentDir: resolve(options.agentDir ?? nativeAgentDir(options.harness)),
      project: options.project ? resolve(options.project) : undefined,
      promptFile: options.promptFile ? resolve(options.promptFile) : undefined,
    }),
    revision,
    capturedAt: now,
    checkedAt: now,
    changed: false,
    error: false,
  };
  jsonWrite(join(store.dir, "capture-sources.json"), all, true);
}
export function checkSources(store: Store, name?: string) {
  const all = sources(store);
  if (name && !all[name])
    throw new Error(
      "Capture this setup locally first so Loadout knows which configuration to check.",
    );
  for (const [key, source] of Object.entries(all))
    if (!name || key === name) {
      try {
        source.changed =
          captureSetup({
            ...source.options,
            prompt: source.options.promptFile
              ? readFileSync(source.options.promptFile, "utf8")
              : source.options.prompt,
          }).revision !== source.revision;
        source.error = false;
      } catch {
        source.error = true;
      }
      source.checkedAt = new Date().toISOString();
    }
  jsonWrite(join(store.dir, "capture-sources.json"), all, true);
  return Object.entries(all)
    .filter(([key]) => !name || key === name)
    .map(([name, source]) => ({
      name,
      capturedRevision: source.revision,
      capturedAt: source.capturedAt,
      checkedAt: source.checkedAt,
      state: source.error
        ? "unavailable"
        : source.changed
          ? "changed"
          : "unchanged",
    }));
}
export function localDeviceStatus(
  store: Store,
  published: Record<string, string>,
  pendingRuns: number,
) {
  const byName = sources(store);
  const all = Object.values(byName);
  const saved = listSetups(store);
  const leases = collectorLeases(store);
  let collector: "running" | "stopped" | "unknown" = leases.length
    ? "stopped"
    : "unknown";
  for (const { lease } of leases)
    if (lease.state === "collecting") {
      try {
        process.kill(lease.pid, 0);
        if (Date.now() - Date.parse(lease.updatedAt) < 30_000)
          collector = "running";
      } catch {
        if (collector !== "running") collector = "unknown";
      }
    }
  return {
    deviceId: store.identity().deviceId,
    pendingRuns,
    savedSetups: saved.length,
    unpublishedSetups: saved.filter(
      (s) => published[s.setup.name] !== s.setup.revision,
    ).length,
    changedSources: all.filter((s) => s.changed && !s.error).length,
    uncheckedSources:
      saved.filter((s) => !byName[s.localName]).length +
      all.filter((s) => s.error).length,
    sourceCheckedAt: all.length ? all.map((s) => s.checkedAt).sort()[0]! : null,
    collector,
  };
}
