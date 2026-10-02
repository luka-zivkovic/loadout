import { z } from "zod";
import type { Registry } from "./registry.js";
import type { WebUser } from "./web-auth.js";
import {
  activityPage,
  analyticsSummary,
  comparisonData,
  comparisonList,
  assessmentsFor,
  periodFilter,
} from "./analytics.js";
import { artifactRef, trialInput } from "./operations.js";
import { metricsSchema } from "./schema.js";
import { TeamError } from "./team-protocol.js";
import { hasMcpDetails } from "./setups.js";

/** Called only after browser authentication and, for writes, CSRF/revocation checks. */
export function workspaceApi(
  registry: Registry,
  url: URL,
  user: WebUser,
  method: string,
  input: unknown,
): { value: unknown } | null {
  const path = url.pathname;
  const ops = registry.ops;
  const admin = () => {
    if (!ops.isAdmin(user.actorId))
      throw new TeamError(403, "admin_required", "Admin access required.");
  };
  if (method === "GET" && path === "/api/dashboard") {
    const f = periodFilter(url);
    const page = activityPage(registry.db, url);
    return {
      value: {
        team: registry.metadata,
        profiles: registry.profiles(),
        skills: registry.skills(),
        ...page,
        summary: analyticsSummary(registry.db, url),
        comparisons: comparisonList(registry.db, url),
        trials: ops.trials(),
        liveRunCount: Number(
          (
            registry.db
              .prepare(
                "SELECT COUNT(*) AS total FROM runs WHERE json_extract(body,'$.mode')='live'",
              )
              .get() as { total: number }
          ).total,
        ),
        days: f.days,
        mode: f.mode,
        truncated: false,
      },
    };
  }
  if (method === "GET" && path === "/api/activity")
    return { value: activityPage(registry.db, url) };
  if (method === "GET" && path === "/api/withdrawals")
    return { value: { withdrawals: ops.withdrawals() } };
  if (method === "GET" && path === "/api/library/unavailable") {
    const unavailable = (["profile", "skill"] as const).flatMap((kind) =>
      ops.listings(kind, true).flatMap((p) => {
        const withdrawn = ops.withdrawn(kind, p.owner, p.name, p.revision);
        const blockedSkills =
          kind === "profile"
            ? ops.blockedPins(p as import("./team-protocol.js").ProfileListing)
            : [];
        return withdrawn || blockedSkills.length
          ? [
              {
                kind,
                ...p,
                withdrawnAt: withdrawn?.withdrawn_at ?? null,
                blockedSkills,
              },
            ]
          : [];
      }),
    );
    return { value: { unavailable } };
  }
  if (method === "POST" && path === "/api/artifacts/withdraw") {
    const body = artifactRef
      .extend({ kind: z.enum(["profile", "skill"]) })
      .strict()
      .parse(input);
    return {
      value: ops.withdraw(user.actorId, body.kind, {
        owner: body.owner,
        name: body.name,
        revision: body.revision,
      }),
    };
  }
  const history =
    /^\/api\/artifacts\/(profile|skill)\/([^/]+)\/([^/]+)\/history$/.exec(path);
  if (method === "GET" && history)
    return {
      value: {
        history: ops.history(
          history[1] as "profile" | "skill",
          decodeURIComponent(history[2]!),
          decodeURIComponent(history[3]!),
        ),
      },
    };
  const file =
    /^\/api\/artifacts\/(profile|skill)\/([^/]+)\/([^/]+)\/([^/]+)\/file$/.exec(
      path,
    );
  if (method === "GET" && file) {
    const [owner, name, revision] = [
      decodeURIComponent(file[2]!),
      decodeURIComponent(file[3]!),
      file[4]!,
    ];
    const profile = file[1] === "profile" ? registry.profile(owner, name, revision) : null;
    if (profile && hasMcpDetails(profile))
      throw new TeamError(410, "legacy_mcp_details", "This historical setup contains MCP connection details. Recapture and publish a names-only revision.");
    const artifact = profile ?? registry.skill(owner, name, revision);
    const packed = artifact.files.find(
      (f) => f.path === url.searchParams.get("path"),
    );
    if (!packed)
      throw new TeamError(404, "not_found", "File not found in this revision.");
    const bytes = Buffer.from(packed.data, "base64");
    const binary = bytes.includes(0);
    const limit = 200_000;
    return {
      value: {
        path: packed.path,
        sha256: packed.sha256,
        executable: Boolean(packed.executable),
        bytes: bytes.length,
        binary,
        truncated: bytes.length > limit,
        text: binary ? null : bytes.subarray(0, limit).toString("utf8"),
      },
    };
  }
  const skillActivity =
    /^\/api\/skills\/([^/]+)\/([^/]+)\/([^/]+)\/activity$/.exec(path);
  if (method === "GET" && skillActivity) {
    const ref = artifactRef.parse({
      owner: decodeURIComponent(skillActivity[1]!),
      name: decodeURIComponent(skillActivity[2]!),
      revision: skillActivity[3],
    });
    registry.skill(ref.owner, ref.name, ref.revision);
    // Skill history has its own explicit period/mode; catalogue compatibility cannot filter observations.
    const filters = url;
    for (const k of ["harness", "query", "owner", "setup", "workflow"])
      filters.searchParams.delete(k);
    filters.searchParams.set("skill", ref.revision);
    return {
      value: {
        summary: analyticsSummary(registry.db, filters),
        feedback: ops.feedbackSummary(ref),
      },
    };
  }
  if (method === "POST" && path === "/api/skills/feedback") {
    const body = artifactRef
      .extend({ value: z.enum(["useful", "needs-local-setup"]) })
      .strict()
      .parse(input);
    return {
      value: {
        feedback: ops.feedback(
          user.actorId,
          { owner: body.owner, name: body.name, revision: body.revision },
          body.value,
        ),
      },
    };
  }
  if (path === "/api/trials" && method === "POST")
    return {
      value: { trial: ops.createTrial(user.actorId, trialInput.parse(input)) },
    };
  if (path === "/api/trials" && method === "GET")
    return { value: { trials: ops.trials() } };
  const trial = /^\/api\/trials\/([^/]+)(\/conclusion)?$/.exec(path);
  if (trial && method === "GET" && !trial[2])
    return {
      value: {
        trial: ops.trial(trial[1]!),
        ...comparisonData(registry.db, trial[1]!),
      },
    };
  if (trial && method === "POST" && trial[2]) {
    const body = z
      .object({
        conclusion: z.enum([
          "keep-baseline",
          "adopt-candidate",
          "insufficient-evidence",
        ]),
      })
      .strict()
      .parse(input);
    return {
      value: { trial: ops.conclude(user.actorId, trial[1]!, body.conclusion) },
    };
  }
  const comparison = /^\/api\/comparisons\/([^/]+)$/.exec(path);
  if (comparison && method === "GET")
    return { value: comparisonData(registry.db, comparison[1]!) };
  const run = /^\/api\/runs\/([^/]+)$/.exec(path);
  if (run && method === "GET") {
    z.uuid().parse(run[1]);
    const row = registry.db
      .prepare("SELECT body FROM runs WHERE run_id=?")
      .get(run[1]!);
    if (!row) throw new TeamError(404, "not_found", "Run not found.");
    let record;
    try {
      record = metricsSchema.parse(JSON.parse(String(row.body)));
    } catch {
      throw new TeamError(
        500,
        "invalid_record",
        "The stored run record is invalid.",
      );
    }
    return {
      value: {
        record,
        assessments: assessmentsFor(registry.db, [run[1]!]),
      },
    };
  }
  if (path === "/api/admin/operations" && method === "GET") {
    admin();
    const before = z.coerce
      .number()
      .int()
      .min(1)
      .parse(url.searchParams.get("before") ?? Number.MAX_SAFE_INTEGER);
    return {
      value: {
        events: ops.events(before),
        usage: ops.usage(),
        withdrawals: ops.withdrawals(),
        devices: registry.db
          .prepare(
            "SELECT t.token_id AS tokenId,t.actor_id AS actorId,t.expires_at AS expiresAt,t.revoked_at AS revokedAt,d.label,d.last_used_at AS lastUsedAt,s.synced_at AS syncedAt FROM tokens t LEFT JOIN web_device_tokens d ON d.token_id=t.token_id LEFT JOIN device_sync s ON s.token_id=t.token_id ORDER BY t.created_at DESC",
          )
          .all(),
      },
    };
  }
  if (path === "/api/admin/limits" && method === "POST") {
    admin();
    return { value: { limits: ops.setLimits(user.actorId, input) } };
  }
  if (path === "/api/admin/purge" && method === "POST") {
    admin();
    z.object({ confirm: z.literal("purge-withdrawn") })
      .strict()
      .parse(input);
    return { value: ops.purge(user.actorId) };
  }
  return null;
}
