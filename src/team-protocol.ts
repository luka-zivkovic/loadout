import { z } from "zod";
import {
  assessmentSchema,
  hash,
  id,
  metricsSchema,
  scope,
  setupHarnessSchema,
  skillSchema,
} from "./schema.js";

export const teamIdentitySchema = z
  .object({
    teamId: z.uuid(),
    teamName: id,
    scope,
    actorId: id,
    tokenId: z.uuid(),
  })
  .strict();
export const credentialSchema = teamIdentitySchema
  .extend({
    schemaVersion: z.literal(1),
    token: z.string().regex(/^ps_[a-f0-9]{64}$/),
  })
  .strict();
export const profileListingSchema = z
  .object({
    owner: id,
    name: id,
    revision: hash,
    workflowId: id,
    description: z.string().max(240).optional(),
    model: z.string().max(301),
    piVersion: z.string().max(30).optional(),
    harness: z
      .object({ kind: setupHarnessSchema, version: z.string().max(80) })
      .strict()
      .optional(),
    publishedAt: z.iso.datetime(),
    skills: z.number().int().nonnegative(),
    extensions: z.number().int().nonnegative(),
    skillPins: z
      .array(z.object({ name: id, revision: hash }).strict())
      .optional(),
  })
  .strict();
export const skillListingSchema = skillSchema
  .omit({ kind: true, schemaVersion: true, files: true, scope: true })
  .extend({
    owner: id,
    publishedAt: z.iso.datetime(),
    files: z.number().int().nonnegative(),
  })
  .strict();
export type SkillListing = z.infer<typeof skillListingSchema>;
export const withdrawalSchema = z
  .object({
    kind: z.enum(["profile", "skill"]),
    owner: id,
    name: id,
    revision: hash,
    withdrawnAt: z.iso.datetime(),
  })
  .strict();
export type Withdrawal = z.infer<typeof withdrawalSchema>;
export const changeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      seq: z.number().int().positive(),
      kind: z.literal("withdrawal"),
      value: withdrawalSchema,
    })
    .strict(),
  z
    .object({
      seq: z.number().int().positive(),
      kind: z.literal("profile"),
      value: profileListingSchema,
    })
    .strict(),
  z
    .object({
      seq: z.number().int().positive(),
      kind: z.literal("skill"),
      value: skillListingSchema,
    })
    .strict(),
  z
    .object({
      seq: z.number().int().positive(),
      kind: z.literal("run"),
      value: metricsSchema,
    })
    .strict(),
  z
    .object({
      seq: z.number().int().positive(),
      kind: z.literal("assessment"),
      value: assessmentSchema,
    })
    .strict(),
]);
export const changesSchema = z
  .object({
    teamId: z.uuid(),
    scope,
    nextCursor: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    changes: z.array(changeSchema).max(500),
  })
  .strict();
export type TeamIdentity = z.infer<typeof teamIdentitySchema>;
export type ProfileListing = z.infer<typeof profileListingSchema>;
export class TeamError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
