import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { canonical, digest } from "./files.js";
import {
  id,
  metricsSchema,
  thinking,
  type Metrics,
  type NativeSetup,
} from "./schema.js";
import type { Store } from "./store.js";

type Attributes = Record<string, string | number | boolean>;
function attrs(raw: unknown): Attributes {
  const result: Attributes = Object.create(null);
  if (!Array.isArray(raw)) return result;
  for (const a of raw.slice(0, 500)) {
    if (!a || typeof a.key !== "string" || !a.value) continue;
    const value =
      a.value.stringValue ??
      a.value.intValue ??
      a.value.doubleValue ??
      a.value.boolValue;
    if (["string", "number", "boolean"].includes(typeof value))
      result[a.key] = value;
  }
  return result;
}
function number(a: Attributes, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = a[key];
    if (
      typeof value !== "number" &&
      !(typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value))
    )
      continue;
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER) return n;
  }
}
function name(value: unknown): string {
  const s = String(value ?? "unknown");
  return id.safeParse(s).success ? s : `name-${digest(s).slice(0, 16)}`;
}
function modelName(value: unknown): string {
  const s = String(value ?? "unknown");
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,179}$/.test(s)
    ? s
    : `model-${digest(s).slice(0, 16)}`;
}
const emptyCoverage = (): NonNullable<Metrics["coverage"]> => ({
  tools: "unavailable",
  tokens: "unavailable",
  skills: "unavailable",
  turns: "unavailable",
  retries: "unavailable",
  compactions: "unavailable",
});
type Session = {
  record: Metrics;
  first: number;
  last: number;
  model: string;
  provider: string;
  seen: Set<string>;
};

/** OTLP payloads live only during this call. The only retained state is counters, selected names and opaque deduplication hashes. */
export class NativeTelemetry {
  private readonly sessions = new Map<string, Session>();
  private readonly identity: ReturnType<Store["identity"]>;
  constructor(
    readonly setup: NativeSetup,
    store: Store,
    readonly comparisonId: string | null = null,
  ) {
    this.identity = store.identity();
    if (setup.scope !== store.scope)
      throw new Error("Setup and telemetry scopes must match");
    if (setup.harness.kind !== "claude-code" && setup.harness.kind !== "codex")
      throw new Error("Usage collection supports Claude Code and Codex setups only");
  }
  consume(raw: unknown): number {
    if (
      !raw ||
      typeof raw !== "object" ||
      !Array.isArray((raw as any).resourceLogs)
    )
      throw new Error("Expected OTLP JSON resourceLogs");
    let accepted = 0;
    for (const resource of (raw as any).resourceLogs.slice(0, 100)) {
      const common = attrs(resource.resource?.attributes);
      for (const scope of (
        resource.scopeLogs ??
        resource.instrumentationLibraryLogs ??
        []
      ).slice(0, 100))
        for (const log of (scope.logRecords ?? []).slice(0, 10000)) {
          if (
            this.observe(
              { ...common, ...attrs(log.attributes) },
              log.timeUnixNano ?? log.observedTimeUnixNano,
            )
          )
            accepted++;
        }
    }
    return accepted;
  }
  private observe(a: Attributes, nanos?: string) {
    const harness = this.setup.harness.kind;
    if (harness !== "claude-code" && harness !== "codex")
      throw new Error("Usage collection supports Claude Code and Codex setups only");
    const prefix =
      harness === "codex" ? "codex." : "claude_code.";
    const rawName = String(a["event.name"] ?? a.name ?? a.event ?? "");
    const event = rawName.startsWith(prefix)
      ? rawName.slice(prefix.length)
      : rawName.includes(".")
        ? ""
        : rawName;
    const allowed = new Set([
      "conversation_starts",
      "user_prompt",
      "tool_result",
      "api_request",
      "api_error",
      "sse_event",
      "websocket_event",
      "skill_activated",
      "compaction",
    ]);
    if (!allowed.has(event)) return false;
    // A native session identifier is required to prevent unrelated sessions being combined.
    const nativeId =
      a["session.id"] ??
      a["conversation.id"] ??
      a.conversation_id ??
      a["thread.id"];
    if (typeof nativeId !== "string" || !nativeId || nativeId.length > 500)
      return false;
    const key = digest(nativeId);
    const timestamp = a["event.timestamp"]
      ? Date.parse(String(a["event.timestamp"]))
      : nanos && /^\d+$/.test(nanos)
        ? Number(BigInt(nanos) / 1000000n)
        : Date.now();
    if (
      !Number.isFinite(timestamp) ||
      timestamp < 0 ||
      timestamp > Date.now() + 86400000
    )
      return false;
    const signature = digest(
      canonical({
        event,
        time: nanos ?? a["event.timestamp"],
        sequence: a["event.sequence"],
        tool: a.tool_use_id ?? a.call_id,
        request: a.request_id ?? a.response_id,
        fields: a,
      }),
    );
    let session = this.sessions.get(key);
    if (!session) {
      if (this.sessions.size >= 1000)
        throw new Error(
          "Collector reached its session limit; stop and restart after saving",
        );
      const version =
        a["service.version"] ??
        a["app.version"] ??
        a["cli.version"] ??
        this.setup.harness.version;
      session = {
        first: timestamp,
        last: timestamp,
        model: modelName(a.model ?? this.setup.settings.model),
        provider: "unknown",
        seen: new Set(),
        record: {
          schemaVersion: 2,
          runId: randomUUID(),
          comparisonId: this.comparisonId,
          scope: this.setup.scope,
          ...this.identity,
          profileName: this.setup.name,
          profileRevision: this.setup.revision,
          effectiveConfigHash: digest(`unverified-config:${key}`),
          contextHash: digest(`unmeasured-context:${key}`),
          workflowId: this.setup.workflow.id,
          mode: "live",
          source: "telemetry",
          toolPolicy: "profile",
          harness: {
            kind: harness,
            version: modelName(version).slice(0, 80),
          },
          coverage: emptyCoverage(),
          skillPins: this.setup.skillPins.map(({ name, revision }) => ({
            name,
            revision,
          })),
          startedAt: new Date(timestamp).toISOString(),
          status: "recorded",
          failureCode: "none",
          durationMs: 0,
          turns: 0,
          retries: 0,
          compactions: 0,
          models: [],
          tools: [],
          skillsAvailable: [],
          skillsLoaded: [],
          skillCatalog: [],
          skillObservation: "unavailable",
          outcome: null,
        },
      };
      this.sessions.set(key, session);
    }
    if (session.seen.has(signature)) return false;
    if (session.seen.size >= 200000)
      throw new Error(
        "Collector reached its event limit; stop and restart after saving",
      );
    session.seen.add(signature);
    session.first = Math.min(session.first, timestamp);
    session.last = Math.max(session.last, timestamp);
    if (a.model) session.model = modelName(a.model);
    const provider = a.provider_name ?? a.provider ?? a["gen_ai.provider.name"];
    if (provider) session.provider = name(provider);
    const r = session.record;
    const coverage = r.coverage!;
    if (event === "user_prompt") {
      r.turns++;
      coverage.turns = "observed";
    }
    if (event === "compaction") {
      r.compactions++;
      coverage.compactions = "observed";
    }
    if (event === "tool_result") {
      const tool = name(a.tool_name ?? a.tool ?? a.name);
      let row = r.tools.find((t) => t.name === tool);
      if (!row) {
        if (r.tools.length >= 200) return false;
        row = {
          name: tool,
          calls: 0,
          completed: 0,
          errors: 0,
          totalDurationMs: 0,
        };
        r.tools.push(row);
      }
      row.calls++;
      row.completed++;
      if (a.success === false || a.success === "false") row.errors++;
      row.totalDurationMs += number(a, "duration_ms", "duration.ms") ?? 0;
      coverage.tools = "observed";
    }
    if (event === "skill_activated") {
      const skillName = String(a["skill.name"] ?? "");
      // Native names are observations; a selected setup is not proof of the loaded file/version.
      if (skillName && skillName !== "custom_skill") {
        const observedName = name(skillName);
        const h = digest(`native-skill-name:${observedName}`);
        if (!r.skillsLoaded.includes(h)) {
          r.skillsLoaded.push(h);
          r.skillCatalog.push({ name: observedName, hash: h });
        }
        coverage.skills = "observed";
        r.skillObservation = "native-events";
      }
    }
    const claude = this.setup.harness.kind === "claude-code";
    const complete = [
      a["event.kind"],
      a.kind,
      a["response.event"],
      a["sse.event_type"],
    ].includes("response.completed");
    if (
      (claude && event === "api_request") ||
      (!claude && ["sse_event", "websocket_event"].includes(event) && complete)
    ) {
      const input = number(a, "input_tokens", "input_token_count");
      const output = number(a, "output_tokens", "output_token_count");
      // Codex emits both a stream timing event and a usage event for one completion.
      // Count the usage event once; the timing-only event is not another model call.
      if (!claude && (input === undefined || output === undefined)) return true;
      let row = r.models.find(
        (m) => m.model === session!.model && m.provider === session!.provider,
      );
      if (!row) {
        if (r.models.length >= 100) return false;
        row = {
          provider: session.provider,
          model: session.model,
          thinking: null,
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCostUsd: null,
          usageCalls: 0,
        };
        r.models.push(row);
      }
      const effort = thinking.safeParse(
        a.effort ?? a.reasoning_effort ?? a.model_reasoning_effort,
      );
      if (effort.success) row.thinking = effort.data;
      row.calls++;
      const cache =
        number(
          a,
          "cache_read_tokens",
          "cached_input_tokens",
          "cached_input_token_count",
          "cached_token_count",
        ) ?? 0;
      const cacheWrite =
        number(a, "cache_creation_tokens", "cache_write_token_count") ?? 0;
      if (
        input !== undefined &&
        output !== undefined &&
        [input, output, cache, cacheWrite].every(Number.isSafeInteger) &&
        (claude || cache <= input)
      ) {
        row.usageCalls++;
        row.inputTokens += claude ? input : Math.max(0, input - cache);
        row.outputTokens += output;
        row.cacheReadTokens += cache;
        row.cacheWriteTokens += cacheWrite;
        coverage.tokens = "observed";
      }
      const cost =
        number(a, "cost_usd") ??
        (number(a, "cost_usd_micros") !== undefined
          ? number(a, "cost_usd_micros")! / 1_000_000
          : undefined);
      if (
        cost !== undefined &&
        (row.calls === 1 || row.estimatedCostUsd !== null)
      )
        row.estimatedCostUsd = (row.estimatedCostUsd ?? 0) + cost;
      else row.estimatedCostUsd = null;
    }
    return true;
  }
  records(): Metrics[] {
    return [...this.sessions.values()].map((s) =>
      metricsSchema.parse({
        ...s.record,
        durationMs: Math.max(0, s.last - s.first),
        startedAt: new Date(s.first).toISOString(),
      }),
    );
  }
}

export async function serveTelemetry(
  collector: NativeTelemetry,
  options: { port?: number } = {},
) {
  const token = randomBytes(24).toString("hex");
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    if (req.headers.origin || req.headers.authorization !== `Bearer ${token}`) {
      req.resume();
      send(403, { error: "Local collector credential required" });
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/logs") {
      req.resume();
      send(404, {
        error:
          "Only metadata extraction from OTLP logs is supported; traces are not accepted",
      });
      return;
    }
    if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
      req.resume();
      send(415, { error: "Configure OTLP HTTP JSON" });
      return;
    }
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8_000_000) throw new Error("too large");
        chunks.push(chunk);
      }
      collector.consume(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      send(200, {});
    } catch {
      send(400, {
        error: "Invalid or oversized OTLP payload; nothing raw is stored",
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      done();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Collector failed to bind");
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/logs`,
    token,
    close: () =>
      new Promise<void>((done, reject) => {
        server.close((e) => (e ? reject(e) : done()));
        server.closeIdleConnections();
      }),
  };
}
export function telemetryInstructions(
  harness: "claude-code" | "codex",
  endpoint: string,
  token: string,
) {
  if (harness === "codex")
    return `codex -c 'otel.exporter={otlp-http={endpoint="${endpoint}",protocol="json",headers={Authorization="Bearer ${token}"}}}' -c 'otel.trace_exporter="none"' -c 'otel.log_user_prompt=false'`;
  return `CLAUDE_CODE_ENABLE_TELEMETRY=1 OTEL_LOGS_EXPORTER=otlp OTEL_METRICS_EXPORTER=none OTEL_TRACES_EXPORTER=none CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=0 ENABLE_ENHANCED_TELEMETRY_BETA=0 ENABLE_BETA_TRACING_DETAILED=0 OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/json OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=${endpoint} OTEL_EXPORTER_OTLP_LOGS_HEADERS='Authorization=Bearer ${token}' OTEL_LOG_USER_PROMPTS=0 OTEL_LOG_ASSISTANT_RESPONSES=0 OTEL_LOG_TOOL_DETAILS=0 OTEL_LOG_TOOL_CONTENT=0 OTEL_LOG_RAW_API_BODIES=0 claude`;
}
