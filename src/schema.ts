import { z } from "zod";

export const PI_VERSION = "0.85.1";
export const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
export const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const scope = z.enum(["personal", "work"]);
export const thinking = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const amount = z.number().finite().nonnegative();
export const settingsSchema = z.object({
  defaultProvider: z.string().min(1).max(120),
  defaultModel: z.string().min(1).max(180),
  defaultThinkingLevel: thinking.default("medium"),
  defaultTools: z.array(id).max(100).optional(),
  transport: z.enum(["sse", "websocket", "auto"]).optional(),
  compaction: z.object({ enabled: z.boolean().optional(), reserveTokens: count.optional(), keepRecentTokens: count.optional() }).strict().optional(),
  retry: z.object({ enabled: z.boolean().optional(), maxRetries: count.optional(), baseDelayMs: count.optional(),
    provider: z.object({ timeoutMs: count.optional(), maxRetries: count.optional(), maxRetryDelayMs: count.optional() }).strict().optional(),
  }).strict().optional(),
  thinkingBudgets: z.object({ minimal: count.optional(), low: count.optional(), medium: count.optional(), high: count.optional() }).strict().optional(),
  enableSkillCommands: z.boolean().optional(),
}).strict();

export const fileSchema = z.object({ path: z.string().min(1).max(500), data: z.string().max(8_000_000), sha256: hash, executable: z.literal(true).optional() }).strict();
export const profileBodySchema = z.object({
  schemaVersion: z.literal(1), name: id, scope, piVersion: z.literal(PI_VERSION),
  settings: settingsSchema,
  workflow: z.object({ id, prompt: z.string().min(1).max(100_000) }).strict(),
  packages: z.array(z.string().max(500)).max(100),
  resources: z.object({ extensions: z.array(z.string()), skills: z.array(z.string()), prompts: z.array(z.string()) }).strict(),
  instructions: z.array(z.string()).max(100), systemPrompt: z.string().optional(), appendSystemPrompt: z.array(z.string()),
  requirements: z.array(z.string().max(300)).max(100),
  omittedSettings: z.array(id).max(100),
  files: z.array(fileSchema).max(3000),
}).strict();
export const profileSchema = profileBodySchema.extend({ revision: hash }).strict();
export type Profile = z.infer<typeof profileSchema>;
export type ProfileBody = z.infer<typeof profileBodySchema>;
export type PackedFile = z.infer<typeof fileSchema>;

export const metricsSchema = z.object({
  schemaVersion: z.literal(1), runId: z.uuid(), comparisonId: z.uuid().nullable(),
  scope, actorId: id, deviceId: z.uuid(), profileName: id, profileRevision: hash,
  effectiveConfigHash: hash, contextHash: hash, workflowId: id,
  mode: z.enum(["live", "demo"]), source: z.enum(["runner", "extension"]),
  toolPolicy: z.enum(["profile", "read-only"]),
  piVersion: z.literal(PI_VERSION), startedAt: z.iso.datetime(),
  status: z.enum(["completed", "error", "timeout", "aborted"]), durationMs: amount,
  failureCode: z.enum(["none", "provider", "setup", "timeout", "aborted", "workspace_changed", "worker_failed"]),
  turns: count, retries: count, compactions: count,
  models: z.array(z.object({
    provider: z.string().max(120), model: z.string().max(180), thinking: thinking.nullable(),
    calls: count, inputTokens: count, outputTokens: count, cacheReadTokens: count, cacheWriteTokens: count,
    estimatedCostUsd: amount.nullable(), usageCalls: count,
  }).strict()).max(100),
  tools: z.array(z.object({ name: id, calls: count, errors: count, completed: count, totalDurationMs: amount }).strict()).max(200),
  skillsAvailable: z.array(hash).max(3000), skillsLoaded: z.array(hash).max(3000),
  skillCatalog: z.array(z.object({ name: id, hash }).strict()).max(3000),
  skillObservation: z.literal("observed-file-reads-and-explicit-commands"),
  outcome: z.object({ validFindings: count, falsePositives: count, missedKnownIssues: count, evaluator: z.literal("human") }).strict().nullable(),
}).strict();
export type Metrics = z.infer<typeof metricsSchema>;
export const analyticsSchema = z.object({ schemaVersion: z.literal(1), scope, records: z.array(metricsSchema).max(100_000) }).strict();
export const packetSchema = z.object({
  schemaVersion: z.literal(1), base: z.string().regex(/^[a-f0-9]{40,64}$/), head: z.string().regex(/^[a-f0-9]{40,64}$/),
  files: z.array(z.object({ path: z.string(), sha256: hash }).strict()), contextHash: hash,
}).strict();
export type Packet = z.infer<typeof packetSchema>;
