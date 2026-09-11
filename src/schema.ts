import { z } from "zod";

export const PI_VERSION = "0.85.1";
export const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
export const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const scope = z.enum(["personal", "work"]);
export const thinking = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const amount = z.number().finite().nonnegative();
export const settingsSchema = z
  .object({
    defaultProvider: z.string().min(1).max(120),
    defaultModel: z.string().min(1).max(180),
    defaultThinkingLevel: thinking.default("medium"),
    defaultTools: z.array(id).max(100).optional(),
    transport: z.enum(["sse", "websocket", "auto"]).optional(),
    compaction: z
      .object({
        enabled: z.boolean().optional(),
        reserveTokens: count.optional(),
        keepRecentTokens: count.optional(),
      })
      .strict()
      .optional(),
    retry: z
      .object({
        enabled: z.boolean().optional(),
        maxRetries: count.optional(),
        baseDelayMs: count.optional(),
        provider: z
          .object({
            timeoutMs: count.optional(),
            maxRetries: count.optional(),
            maxRetryDelayMs: count.optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    thinkingBudgets: z
      .object({
        minimal: count.optional(),
        low: count.optional(),
        medium: count.optional(),
        high: count.optional(),
      })
      .strict()
      .optional(),
    enableSkillCommands: z.boolean().optional(),
  })
  .strict();

export const fileSchema = z
  .object({
    path: z.string().min(1).max(500),
    data: z.string().max(8_000_000),
    sha256: hash,
    executable: z.literal(true).optional(),
  })
  .strict();
export const harnessSchema = z.enum(["pi", "claude-code", "codex"]);
export type Harness = z.infer<typeof harnessSchema>;
export const harnessLabels: Record<Harness, string> = {
  pi: "Pi",
  "claude-code": "Claude Code",
  codex: "Codex",
};
export const skillBodySchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("skill"),
    name: id,
    scope,
    description: z.string().min(1).max(2000),
    compatibleWith: z.array(harnessSchema).min(1).max(3),
    requirements: z.array(z.string().min(1).max(300)).max(100),
    files: z.array(fileSchema).min(1).max(3000),
  })
  .strict();
export const skillSchema = skillBodySchema.extend({ revision: hash }).strict();
export type Skill = z.infer<typeof skillSchema>;
export const skillPinSchema = skillSchema
  .omit({ kind: true, schemaVersion: true, files: true, scope: true })
  .extend({ path: z.string().min(1).max(500) })
  .strict();
export type SkillPin = z.infer<typeof skillPinSchema>;
export const profileBodySchema = z
  .object({
    schemaVersion: z.literal(1),
    name: id,
    scope,
    piVersion: z.literal(PI_VERSION),
    settings: settingsSchema,
    workflow: z.object({ id, prompt: z.string().min(1).max(100_000) }).strict(),
    packages: z.array(z.string().max(500)).max(100),
    resources: z
      .object({
        extensions: z.array(z.string()),
        skills: z.array(z.string()),
        prompts: z.array(z.string()),
      })
      .strict(),
    instructions: z.array(z.string()).max(100),
    systemPrompt: z.string().optional(),
    appendSystemPrompt: z.array(z.string()),
    requirements: z.array(z.string().max(300)).max(100),
    omittedSettings: z.array(id).max(100),
    skillPins: z.array(skillPinSchema).max(3000).optional(),
    files: z.array(fileSchema).max(3000),
  })
  .strict();
export const profileSchema = profileBodySchema
  .extend({ revision: hash })
  .strict();
export type Profile = z.infer<typeof profileSchema>;
export type ProfileBody = z.infer<typeof profileBodySchema>;
export type PackedFile = z.infer<typeof fileSchema>;

export const nativeSetupBodySchema = z
  .object({
    schemaVersion: z.literal(2),
    kind: z.literal("setup"),
    name: id,
    scope,
    harness: z
      .object({
        kind: z.enum(["claude-code", "codex"]),
        version: z.string().min(1).max(80),
      })
      .strict(),
    settings: z.record(z.string(), z.unknown()),
    mcpServers: z.record(z.string(), z.unknown()).optional(),
    workflow: z.object({ id, prompt: z.string().min(1).max(100_000) }).strict(),
    resources: z
      .object({
        skills: z.array(z.string()),
        hooks: z.array(z.string()),
        agents: z.array(z.string()),
        prompts: z.array(z.string()),
      })
      .strict(),
    instructions: z.array(z.string()).max(100),
    requirements: z.array(z.string().max(300)).max(100),
    omittedSettings: z.array(z.string().max(300)).max(500),
    skillPins: z.array(skillPinSchema).max(3000),
    files: z.array(fileSchema).max(3000),
  })
  .strict();
export const nativeSetupSchema = nativeSetupBodySchema
  .extend({ revision: hash })
  .strict();
export const setupSchema = z.union([profileSchema, nativeSetupSchema]);
export type NativeSetup = z.infer<typeof nativeSetupSchema>;
export type Setup = z.infer<typeof setupSchema>;
export const setupHarness = (s: Setup): Harness =>
  s.schemaVersion === 1 ? "pi" : s.harness.kind;
export const setupVersion = (s: Setup): string =>
  s.schemaVersion === 1 ? s.piVersion : s.harness.version;

export const metricsSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    runId: z.uuid(),
    comparisonId: z.uuid().nullable(),
    scope,
    actorId: id,
    deviceId: z.uuid(),
    profileName: id,
    profileRevision: hash,
    effectiveConfigHash: hash,
    contextHash: hash,
    workflowId: id,
    mode: z.enum(["live", "demo"]),
    source: z.enum(["runner", "extension", "telemetry"]),
    toolPolicy: z.enum(["profile", "read-only"]),
    piVersion: z.literal(PI_VERSION).optional(),
    harness: z
      .object({ kind: harnessSchema, version: z.string().min(1).max(80) })
      .strict()
      .optional(),
    coverage: z
      .object({
        tools: z.enum(["observed", "unavailable"]),
        tokens: z.enum(["observed", "unavailable"]),
        skills: z.enum(["observed", "unavailable"]),
        turns: z.enum(["observed", "unavailable"]),
        retries: z.enum(["observed", "unavailable"]),
        compactions: z.enum(["observed", "unavailable"]),
      })
      .strict()
      .optional(),
    skillPins: z
      .array(z.object({ name: id, revision: hash }).strict())
      .max(3000)
      .optional(),
    startedAt: z.iso.datetime(),
    collectionState: z
      .enum(["collecting", "stopped", "interrupted"])
      .optional(),
    status: z.enum(["completed", "error", "timeout", "aborted", "recorded"]),
    durationMs: amount,
    failureCode: z.enum([
      "none",
      "provider",
      "setup",
      "timeout",
      "aborted",
      "workspace_changed",
      "worker_failed",
    ]),
    turns: count,
    retries: count,
    compactions: count,
    models: z
      .array(
        z
          .object({
            provider: z.string().max(120),
            model: z.string().max(180),
            thinking: thinking.nullable(),
            calls: count,
            inputTokens: count,
            outputTokens: count,
            cacheReadTokens: count,
            cacheWriteTokens: count,
            estimatedCostUsd: amount.nullable(),
            usageCalls: count,
          })
          .strict(),
      )
      .max(100),
    tools: z
      .array(
        z
          .object({
            name: id,
            calls: count,
            errors: count,
            completed: count,
            totalDurationMs: amount,
          })
          .strict(),
      )
      .max(200),
    skillsAvailable: z.array(hash).max(3000),
    skillsLoaded: z.array(hash).max(3000),
    skillCatalog: z.array(z.object({ name: id, hash }).strict()).max(3000),
    skillObservation: z.enum([
      "observed-file-reads-and-explicit-commands",
      "native-events",
      "unavailable",
    ]),
    outcome: z
      .object({
        validFindings: count,
        falsePositives: count,
        missedKnownIssues: count,
        evaluator: z.literal("human"),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.collectionState && r.source !== "telemetry")
      ctx.addIssue({
        code: "custom",
        message: "Collection checkpoints only apply to native telemetry",
      });
    if (
      r.schemaVersion === 1 &&
      (!r.piVersion ||
        (r.harness && r.harness.kind !== "pi") ||
        r.source === "telemetry" ||
        r.status === "recorded")
    )
      ctx.addIssue({
        code: "custom",
        message: "Legacy measurements must identify Pi",
      });
    if (r.schemaVersion === 2 && (!r.harness || !r.coverage || r.piVersion))
      ctx.addIssue({
        code: "custom",
        message: "Native measurements require harness identity and coverage",
      });
  });
export type Metrics = z.infer<typeof metricsSchema>;
export const assessmentSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.uuid(),
    runId: z.uuid(),
    actorId: id,
    parents: z.array(z.uuid()).max(100),
    createdAt: z.iso.datetime(),
    outcome: metricsSchema.shape.outcome.unwrap(),
  })
  .strict();
export type Assessment = z.infer<typeof assessmentSchema>;
export const analyticsSchema = z.discriminatedUnion("schemaVersion", [
  z
    .object({
      schemaVersion: z.literal(1),
      scope,
      records: z.array(metricsSchema).max(100_000),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(2),
      scope,
      records: z.array(metricsSchema).max(100_000),
      assessments: z.array(assessmentSchema).max(100_000),
    })
    .strict(),
]);
export const packetSchema = z
  .object({
    schemaVersion: z.literal(1),
    base: z.string().regex(/^[a-f0-9]{40,64}$/),
    head: z.string().regex(/^[a-f0-9]{40,64}$/),
    files: z.array(z.object({ path: z.string(), sha256: hash }).strict()),
    contextHash: hash,
  })
  .strict();
export type Packet = z.infer<typeof packetSchema>;
