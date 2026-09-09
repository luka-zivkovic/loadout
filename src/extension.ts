import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { canonical, digest } from "./files.js";
import { Collector } from "./metrics.js";
import { captureProfile, saveProfile } from "./profiles.js";
import { id, PI_VERSION, type Metrics } from "./schema.js";
import { Store } from "./store.js";

/** Opt-in workflow measurement for an existing Pi session. No network exporter or transcript reader. */
export default function extension(pi: ExtensionAPI) {
  if (process.env.PI_SHARE_DISABLED === "1") return;
  let active: { collector: Collector; store: Store; ctx: ExtensionContext; skillCommandsEnabled: boolean } | undefined;
  const stop = (status?: Metrics["status"]) => {
    if (!active) return;
    const record = active.collector.finish(status);
    active.store.writeMetrics(record); active.ctx.ui.notify(`Saved workflow metrics ${record.runId} (${record.scope})`, "info"); active = undefined;
  };
  pi.registerCommand("share-start", {
    description: "Start metadata-only measurement: /share-start workflow-id",
    handler: async (args, ctx) => {
      try {
        if (active) throw new Error("Use /share-stop before starting another measured workflow");
        const workflowId = id.parse(args.trim());
        if (!ctx.model) throw new Error("Select a model first");
        const store = new Store(undefined, process.env.PI_SHARE_SCOPE ?? "personal");
        const profile = saveProfile(store, captureProfile({ name: process.env.PI_SHARE_PROFILE ?? "local", scope: store.scope,
          agentDir: getAgentDir(), project: ctx.cwd, workflowId, model: `${ctx.model.provider}/${ctx.model.id}`,
          prompt: `Explicitly measured interactive workflow: ${workflowId}`,
        }));
        const skills = (ctx.getSystemPromptOptions().skills ?? []).map(s => ({ name: s.name, path: s.filePath, hash: digest(readFileSync(s.filePath)) }));
        const collector = new Collector({
          runId: randomUUID(), comparisonId: null, scope: store.scope, ...store.identity(process.env.PI_SHARE_ACTOR),
          profileName: profile.name, profileRevision: profile.revision, workflowId, mode: "live", source: "extension", piVersion: PI_VERSION, toolPolicy: "profile",
          effectiveConfigHash: digest(canonical({ profile: profile.revision, system: ctx.getSystemPrompt(), tools: pi.getAllTools(), active: pi.getActiveTools(), model: ctx.model })),
          // Hash only: conversation contents are not written or exported by pi-share.
          contextHash: digest(canonical(ctx.sessionManager.getBranch())),
        }, ctx.cwd, skills);
        active = { collector, store, ctx, skillCommandsEnabled: profile.settings.enableSkillCommands !== false }; ctx.ui.notify(`Measuring ${workflowId} in ${store.scope}; use /share-stop to finish`, "info");
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : "Could not start measurement", "error"); }
    },
  });
  pi.registerCommand("share-stop", { description: "Finish this workflow and save only its metadata", handler: async (_args, ctx) => {
    if (!active) ctx.ui.notify("No measured workflow is active", "info"); else stop();
  } });
  for (const event of ["turn_start", "message_end", "tool_execution_start", "tool_execution_end", "session_compact"] as const) {
    pi.on(event as "turn_start", ((e: any) => { active?.collector.observe(e, pi.getThinkingLevel()); }) as any);
  }
  pi.on("input", event => { if (active?.skillCommandsEnabled) active.collector.explicitSkill(event.text); });
  pi.on("session_shutdown", () => stop("aborted"));
}
