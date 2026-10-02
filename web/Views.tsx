import { WorkspaceOperations } from "./Operations";
import { useParam, go, setParam } from "./navigation";
import { Trials } from "./Trials";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Box,
  Check,
  Code2,
  GitCompareArrows,
  Monitor,
  Plus,
  ShieldCheck,
  Search,
  X,
} from "lucide-react";
import {
  api,
  cost,
  measurement,
  measured,
  runHarnessLabel,
  runHarness,
  Copy,
  date,
  Empty,
  ErrorBox,
  Field,
  Modal,
  money,
  num,
  short,
  type Dashboard,
} from "./shared";
import { HarnessLabel } from "./HarnessIcon";
import type { Assessment, Harness, Metrics, Profile } from "../src/schema";
import type { ProfileListing } from "../src/team-protocol";
import type { WebUser } from "../src/web-auth";
import { SharingNotice } from "./Sharing";

export const heads = (events: Assessment[]) => {
  const parents = new Set(events.flatMap((e) => e.parents));
  return events.filter((e) => !parents.has(e.eventId));
};
const duration = (r: Metrics) =>
  r.durationMs < 60000
    ? `${(r.durationMs / 1000).toFixed(1)}s`
    : `${(r.durationMs / 60000).toFixed(1)}m`;
const models = (r: Metrics) =>
  r.models
    .map((m) => `${m.provider}/${m.model} (${m.thinking ?? "unspecified"})`)
    .join(", ") || "Not observed";
const calls = (r: Metrics) => r.tools.reduce((n, t) => n + t.calls, 0);
function StateBadge({ run }: { run: Metrics }) {
  return (
    <span
      className={`badge ${run.status === "completed" ? "green" : ["aborted", "recorded"].includes(run.status) ? "amber" : "red"}`}
    >
      {["completed", "recorded"].includes(run.status) ? (
        <Check size={11} />
      ) : (
        <X size={11} />
      )}{" "}
      {run.status}
    </span>
  );
}
function Scores({ run, events }: { run: Metrics; events: Assessment[] }) {
  const latest = heads(events.filter((e) => e.runId === run.runId));
  const grouped = Object.groupBy(latest, (e) => e.actorId);
  return latest.length ? (
    <div className="stack">
      {Object.entries(grouped).map(([actor, group]) => (
        <div key={actor}>
          <span className="badge">{actor}</span>
          {group!.length > 1 ? (
            <span className="badge amber">
              Conflicting scores · {group!.length} versions
            </span>
          ) : null}
          {group!.map((e) => (
            <p key={e.eventId} className="text-small">
              {e.outcome.validFindings} valid · {e.outcome.falsePositives} false
              positives · {e.outcome.missedKnownIssues} missed
            </p>
          ))}
        </div>
      ))}
    </div>
  ) : (
    <span className="muted text-small">Not scored</span>
  );
}

export function ActivityView({
  data,
  user,
  refresh,
  harness,
}: {
  data: Dashboard;
  user: WebUser;
  refresh: () => Promise<unknown>;
  harness: string;
}) {
  const [query, setQuery] = useParam("q");
  const [offset, setOffset] = useParam("offset", "0");
  const [owner, setOwner] = useParam("owner");
  const [workflow, setWorkflow] = useParam("workflow");
  const [runId, setRunId] = useParam("run");
  const [page, setPage] = useState({
    records: data.records,
    assessments: data.assessments,
    total: data.total,
    nextOffset: data.nextOffset,
  });
  const [selectedRuns, setSelectedRuns] = useState<Metrics[]>([]);
  const [compare, setCompare] = useState(false);
  const [compareEvents, setCompareEvents] = useState<Assessment[]>([]);
  const [detail, setDetail] = useState<{
    record: Metrics;
    assessments: Assessment[];
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const pageQuery = `days=${data.days}&mode=${data.mode}&offset=${offset}&query=${encodeURIComponent(query)}${harness ? `&harness=${harness}` : ""}${owner ? `&owner=${encodeURIComponent(owner)}` : ""}${workflow ? `&workflow=${encodeURIComponent(workflow)}` : ""}`;
  useEffect(() => {
    let live = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api(`/activity?${pageQuery}`)
        .then((r) => {
          if (live) {
            setPage(r);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [pageQuery, data]);
  const refreshDetail = async () => {
    if (runId) setDetail(await api(`/runs/${encodeURIComponent(runId)}`));
    await refresh();
  };
  useEffect(() => {
    let live = true;
    setDetail(null);
    if (runId)
      api(`/runs/${encodeURIComponent(runId)}`)
        .then((r) => {
          if (live) setDetail(r);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [runId]);
  const filter = (key: string, value: string) => {
    const params = new URLSearchParams(location.search);
    params.delete("offset");
    if (value) params.set(key, value);
    else params.delete(key);
    const search = params.toString();
    go(`${location.pathname}${search ? `?${search}` : ""}`, true);
  };
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              Shared runs <span className="badge">{page.total}</span>
            </h2>
            <p>Select 2–4 runs. Counts include the full filtered period.</p>
          </div>
          <button
            className="button secondary"
            disabled={selectedRuns.length < 2}
            onClick={async () => {
              try {
                const details = await Promise.all(
                  selectedRuns.map((r) => api(`/runs/${r.runId}`)),
                );
                setCompareEvents(details.flatMap((r) => r.assessments));
                setCompare(true);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Compare {selectedRuns.length || ""}
          </button>
        </div>
        <ErrorBox error={error} />
        <div className="search-row activity-filters">
          <input
            className="search"
            aria-label="Search activity"
            placeholder="Search setups, workflows, models, tools…"
            value={query}
            onChange={(e) => filter("q", e.target.value)}
          />
          <input
            aria-label="Filter by member"
            placeholder="Member handle"
            value={owner}
            onChange={(e) => filter("owner", e.target.value)}
          />
          <input
            aria-label="Filter by workflow"
            placeholder="Workflow ID"
            value={workflow}
            onChange={(e) => filter("workflow", e.target.value)}
          />
        </div>
        {selectedRuns.length > 0 && (
          <div className="selection-strip">
            {selectedRuns.length} runs selected across pages{" "}
            <button className="text-button" onClick={() => setSelectedRuns([])}>
              Clear selection
            </button>
          </div>
        )}
        {loading && (
          <p className="text-small muted" role="status">
            Updating activity…
          </p>
        )}
        {page.records.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Run / setup</th>
                  <th>Member</th>
                  <th>Evidence</th>
                  <th>Time</th>
                  <th>Tools / skills</th>
                  <th>Estimated spend</th>
                </tr>
              </thead>
              <tbody>
                {page.records.map((r) => (
                  <tr key={r.runId}>
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox"
                        aria-label={`Compare ${r.profileName} run ${short(r.runId)}`}
                        checked={selectedRuns.some((s) => s.runId === r.runId)}
                        disabled={
                          !selectedRuns.some((s) => s.runId === r.runId) &&
                          selectedRuns.length >= 4
                        }
                        onChange={(e) =>
                          setSelectedRuns((old) =>
                            e.target.checked
                              ? [...old, r]
                              : old.filter((s) => s.runId !== r.runId),
                          )
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => setRunId(r.runId)}
                      >
                        {r.profileName}
                      </button>
                      <span className="table-sub">
                        <HarnessLabel harness={runHarness(r)} /> ·{" "}
                        {r.workflowId} · {date(r.startedAt)}
                      </span>
                    </td>
                    <td>{r.actorId}</td>
                    <td>
                      <StateBadge run={r} />
                      <span className="table-sub">
                        {r.source === "runner"
                          ? "Frozen task context"
                          : r.source === "telemetry"
                            ? "Context unmeasured"
                            : "Pi starting branch"}
                        {r.collectionState === "interrupted"
                          ? " · Interrupted collector"
                          : ""}
                      </span>
                    </td>
                    <td>{duration(r)}</td>
                    <td>
                      {measurement(r, "tools", calls(r))} calls ·{" "}
                      {measurement(r, "skills", r.skillsLoaded.length)} skills
                    </td>
                    <td>{money(cost(r))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !loading && (
            <Empty title="No matching activity">
              Adjust the filters or sync finalized local measurements.
            </Empty>
          )
        )}
        <div className="pagination">
          <button
            className="button"
            disabled={Number(offset) === 0 || loading}
            onClick={() => setOffset(String(Math.max(0, Number(offset) - 100)))}
          >
            Previous
          </button>
          <span>
            {page.total
              ? `${Number(offset) + 1}–${Number(offset) + page.records.length} of ${page.total}`
              : "0 runs"}
          </span>
          <button
            className="button"
            disabled={page.nextOffset === null || loading}
            onClick={() => setOffset(String(page.nextOffset))}
          >
            Next
          </button>
        </div>
      </section>
      {detail && (
        <RunDetail
          run={detail.record}
          events={detail.assessments}
          user={user}
          refresh={refreshDetail}
          close={() => setRunId(null)}
        />
      )}
      {compare && (
        <Compare
          runs={selectedRuns}
          events={compareEvents}
          close={() => setCompare(false)}
        />
      )}
    </>
  );
}
export function RunDetail({
  run,
  events,
  user,
  refresh,
  close,
}: {
  run: Metrics;
  events: Assessment[];
  user: WebUser;
  refresh: () => Promise<unknown>;
  close: () => void;
}) {
  const [scoring, setScoring] = useState(false);
  return (
    <Modal title={`${run.profileName} · ${short(run.runId)}`} close={close}>
      <div className="modal-body">
        {run.source === "telemetry" && (
          <div className="notice">
            Observed session activity from {runHarnessLabel(run)}. Duration
            covers the received events. Task completion, effective
            configuration, and frozen context are unverified; unavailable fields
            are not counted as zero.
          </div>
        )}
        <div className="detail-grid">
          <div>
            <dt>Status</dt>
            <dd>
              <StateBadge run={run} />
              {run.failureCode !== "none" && ` · ${run.failureCode}`}
            </dd>
          </div>
          <div>
            <dt>Member / started</dt>
            <dd>
              {run.actorId} · {date(run.startedAt)}
            </dd>
          </div>
          <div>
            <dt>Duration / estimated spend</dt>
            <dd>
              {duration(run)} · {money(cost(run))}
            </dd>
          </div>
          <div>
            <dt>Workflow / source</dt>
            <dd>
              <HarnessLabel harness={runHarness(run)} /> · {run.workflowId} ·{" "}
              {run.source}
            </dd>
          </div>
          <div>
            <dt>Model(s)</dt>
            <dd>{models(run)}</dd>
          </div>
          <div>
            <dt>Turns / retries / compactions</dt>
            <dd>
              {measurement(run, "turns", run.turns)} /{" "}
              {measurement(run, "retries", run.retries)} /{" "}
              {measurement(run, "compactions", run.compactions)}
            </dd>
          </div>
        </div>
        <h3 className="section-title">Tools used</h3>
        {run.tools.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Calls</th>
                  <th>Completed</th>
                  <th>Errors</th>
                  <th>Total time</th>
                </tr>
              </thead>
              <tbody>
                {run.tools.map((t) => (
                  <tr key={t.name}>
                    <td>
                      <code>{t.name}</code>
                    </td>
                    <td>{t.calls}</td>
                    <td>{t.completed}</td>
                    <td>{t.errors}</td>
                    <td>{(t.totalDurationMs / 1000).toFixed(1)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            {measured(run, "tools")
              ? "No tool calls observed."
              : "Tool usage is unavailable for this observation."}
          </p>
        )}
        <h3 className="section-title">Observed skill loads</h3>
        <div className="tag-list">
          {run.skillsLoaded.length ? (
            run.skillsLoaded.map((h) => (
              <span className="badge" key={h}>
                {run.skillCatalog.find((s) => s.hash === h)?.name ?? short(h)}
              </span>
            ))
          ) : (
            <p className="muted">
              {measured(run, "skills")
                ? "No skill loads observed."
                : "Skill activation is unavailable or redacted by this harness."}
            </p>
          )}
        </div>
        <p className="text-small muted spaced">
          {run.source === "telemetry"
            ? "Native activation names, when provided. These do not verify which skill file or revision was loaded."
            : "Observed file reads and explicit commands; this does not capture every way a skill can influence a session."}
        </p>
        <h3 className="section-title">Token usage</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Input</th>
                <th>Output</th>
                <th>Cache read / write</th>
                <th>Calls with usage</th>
              </tr>
            </thead>
            <tbody>
              {run.models.map((m, i) => (
                <tr key={i}>
                  <td>{m.model}</td>
                  <td>{m.usageCalls ? num(m.inputTokens) : "Unavailable"}</td>
                  <td>{m.usageCalls ? num(m.outputTokens) : "Unavailable"}</td>
                  <td>
                    {m.usageCalls
                      ? `${num(m.cacheReadTokens)} / ${num(m.cacheWriteTokens)}`
                      : "Unavailable"}
                  </td>
                  <td>
                    {m.usageCalls} / {m.calls}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="spaced">
          <summary className="text-small">
            Context and configuration fingerprints
          </summary>
          <pre>
            {JSON.stringify(
              {
                contextHash:
                  run.source === "telemetry" ? "Unmeasured" : run.contextHash,
                profileRevision: run.profileRevision,
                effectiveConfigHash:
                  run.source === "telemetry"
                    ? "Unverified"
                    : run.effectiveConfigHash,
                toolPolicy: run.toolPolicy,
                comparisonId: run.comparisonId,
                deviceId: run.deviceId,
              },
              null,
              2,
            )}
          </pre>
        </details>
        <h3 className="section-title">Human assessments</h3>
        <Scores run={run} events={events} />
        {run.status === "completed" && (
          <button
            className="button secondary spaced"
            onClick={() => setScoring(true)}
          >
            Add or revise my assessment
          </button>
        )}
        {scoring && (
          <ScoreForm
            run={run}
            events={events}
            user={user}
            saved={async () => {
              await refresh();
              setScoring(false);
            }}
          />
        )}
      </div>
    </Modal>
  );
}
function ScoreForm({
  run,
  events,
  user,
  saved,
}: {
  run: Metrics;
  events: Assessment[];
  user: WebUser;
  saved: () => Promise<void>;
}) {
  const [parents] = useState(() =>
    heads(
      events.filter((e) => e.runId === run.runId && e.actorId === user.actorId),
    ),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const old = parents.length === 1 ? parents[0].outcome : undefined;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fields = new FormData(e.currentTarget);
    try {
      await api("/assessments", {
        runId: run.runId,
        parents: parents.map((e) => e.eventId),
        outcome: {
          validFindings: Number(fields.get("validFindings")),
          falsePositives: Number(fields.get("falsePositives")),
          missedKnownIssues: Number(fields.get("missedKnownIssues")),
          evaluator: "human",
        },
      });
      await saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="spaced">
      <p className="muted">
        Review the output locally before scoring. This records your assessment
        as {user.actorId}.
      </p>
      {parents.length > 1 && (
        <div className="notice">
          This score will resolve your {parents.length} conflicting versions.
          Review them above before saving.
        </div>
      )}
      <div className="score-inputs">
        {(
          ["validFindings", "falsePositives", "missedKnownIssues"] as const
        ).map((key, i) => (
          <Field
            label={
              ["Valid findings", "False positives", "Missed known issues"][i]
            }
            key={key}
          >
            <input
              name={key}
              type="number"
              required
              min={0}
              max={10000}
              step={1}
              defaultValue={old?.[key]}
            />
          </Field>
        ))}
      </div>
      <ErrorBox error={error} />
      <button className="button primary" disabled={busy}>
        {busy ? "Saving…" : "Save assessment"}
      </button>
    </form>
  );
}
export function Comparisons({
  data,
  user,
  refresh,
}: {
  data: Dashboard;
  user: WebUser;
  refresh: () => Promise<unknown>;
}) {
  return <Trials data={data} user={user} refresh={refresh} />;
}
function Compare({
  runs,
  events,
  close,
}: {
  runs: Metrics[];
  events: Assessment[];
  close: () => void;
}) {
  return (
    <Modal title="Compare runs" close={close}>
      <div className="modal-body">
        <ComparisonTable runs={runs} events={events} />
      </div>
    </Modal>
  );
}
export function ComparisonTable({
  runs,
  events,
}: {
  runs: Metrics[];
  events: Assessment[];
}) {
  if (!runs.length) return <p className="muted">No synced runs yet.</p>;
  const frozen = runs.every((r) => r.source === "runner");
  const contexts = new Set(runs.map((r) => r.contextHash));
  const explanation = runs.some((r) => r.source === "telemetry")
    ? "Includes native observations. Their task context and effective configuration were not measured; the setup revision is an attribution label."
    : !frozen
      ? "Includes Pi interactive sessions. A starting branch fingerprint does not establish equal code or task context."
      : contexts.size === 1
        ? "Same frozen context fingerprint across these runs."
        : "Different frozen contexts. Changes in results may come from the task as well as the setup.";
  const rows: { name: string; value: (r: Metrics) => React.ReactNode }[] = [
    {
      name: "Harness / status",
      value: (r) => (
        <>
          <HarnessLabel harness={runHarness(r)} />
          <span className="table-sub">
            {r.status}
            {r.collectionState === "interrupted"
              ? " · collection interrupted"
              : ""}
          </span>
        </>
      ),
    },
    {
      name: "Revision",
      value: (r) => (
        <code title={r.profileRevision}>{short(r.profileRevision)}</code>
      ),
    },
    { name: "Model / thinking", value: models },
    { name: "Tool policy", value: (r) => r.toolPolicy },
    {
      name: "Context provenance",
      value: (r) =>
        r.source === "telemetry"
          ? "Unmeasured"
          : `${r.source === "runner" ? "Frozen packet" : "Starting branch"} · ${short(r.contextHash)}`,
    },
    { name: "Estimated spend", value: (r) => money(cost(r)) },
    { name: "Observed duration", value: duration },
    { name: "Tool calls", value: (r) => measurement(r, "tools", calls(r)) },
    {
      name: "Observed skills",
      value: (r) => measurement(r, "skills", r.skillsLoaded.length),
    },
    {
      name: "Declared skill revisions",
      value: (r) =>
        r.skillPins?.map((p) => `${p.name}@${short(p.revision)}`).join(", ") ||
        "None declared",
    },
    {
      name: "Human assessment",
      value: (r) => <Scores run={r} events={events} />,
    },
  ];
  return (
    <>
      <div className={frozen && contexts.size === 1 ? "success" : "notice"}>
        {explanation}
      </div>
      {new Set(runs.map(models)).size > 1 && (
        <p className="comparison-caveat">
          Models or thinking settings differ. They are additional experimental
          variables.
        </p>
      )}
      <p className="muted spaced">
        Cost and speed describe usage. Review outputs locally before assessing
        quality. No automatic winner is inferred.
      </p>
      <p className="comparison-scroll-hint text-small muted">
        Scroll sideways to compare every run →
      </p>
      <div
        className="table-wrap comparison-matrix"
        tabIndex={0}
        role="region"
        aria-label="Comparison evidence; scroll horizontally to view every run"
      >
        <table>
          <thead>
            <tr>
              <th>Evidence</th>
              {runs.map((r) => (
                <th key={r.runId}>
                  {r.profileName}
                  <span className="table-sub">
                    {r.actorId} · {short(r.runId)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                {runs.map((r) => (
                  <td key={r.runId}>{row.value(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="comparison-privacy">
        <ShieldCheck size={14} />
        Repository code, task context, and review output remain local.
      </p>
    </>
  );
}

type Device = {
  tokenId: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  syncedAt: string | null;
  sync: {
    pendingRuns: number;
    unpublishedSetups: number;
    changedSources: number;
    uncheckedSources: number;
    sourceCheckedAt: string | null;
    collector: string;
  } | null;
};
export function Devices({ team }: { team: Dashboard["team"] }) {
  const [connect] = useParam("connect");
  const showInstructions = connect === "1";
  const setShowInstructions = (open: boolean) =>
    setParam("connect", open ? "1" : null, !open);
  const [measure, setMeasure] = useParam("measure");
  const [measurementHarness, setMeasurementHarness] = useState<Harness>("pi");
  const [awaiting, setAwaiting] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [instructions, setInstructions] = useState("");
  const [code, setCode] = useState(
    () => new URLSearchParams(location.search).get("code") ?? "",
  );
  const [request, setRequest] = useState<{
    label: string;
    userCode: string;
    expiresAt: string;
    approvedBy: string | null;
    deniedAt: string | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [revoke, setRevoke] = useState<Device | null>(null);
  const reload = () => api("/devices").then((r) => setDevices(r.devices));
  const activeDevices = devices.filter(
    (device) =>
      !device.revokedAt && Date.parse(device.expiresAt) > Date.now(),
  );
  const loginCommand = `loadout team login ${team.teamName} --scope ${team.scope} --url ${location.origin}`;
  const syncCommand = `loadout team sync REMOTE_NAME --scope ${team.scope}`;
  const measurementInstructions =
    measurementHarness === "pi"
      ? `Measure one Pi workflow with Loadout.\n\n1. In Pi, before starting the work, run:\n/share-start WORKFLOW_NAME\n2. Complete the workflow.\n3. Finalize it in Pi with:\n/share-stop\n4. In a terminal, sync the saved metadata:\n${syncCommand}\n\nOnly activity between /share-start and /share-stop is measured. Existing sessions are not imported. Replace REMOTE_NAME with the local Loadout remote shown by team status.`
      : `Measure one ${measurementHarness === "claude-code" ? "Claude Code" : "Codex"} workflow with Loadout.\n\n1. Start the local metadata collector before the work:\nloadout telemetry listen SETUP_ALIAS --scope ${team.scope}\n2. Run the harness command printed by the collector in another terminal.\n3. Exit the harness so it flushes, then stop the collector with Ctrl-C.\n4. Sync the finalized metadata:\n${syncCommand}\n\nExisting sessions are not imported. Replace SETUP_ALIAS and REMOTE_NAME with names from your local Loadout store. The collector records counters and metadata, not prompts, code, or tool contents.`;
  useEffect(() => {
    Promise.all([
      reload(),
      api("/instructions").then((r) => setInstructions(r.instructions)),
    ]).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!awaiting) return;
    const known = new Set(devices.map((d) => d.tokenId));
    let attempts = 0;
    const timer = setInterval(() => {
      api("/devices")
        .then((r) => {
          setDevices(r.devices);
          if (r.devices.some((d: Device) => !known.has(d.tokenId))) {
            setMessage(
              "Device authorized. Choose what to capture or sync on that device.",
            );
            setAwaiting(false);
          }
        })
        .catch((e) => setError(e.message));
      if (++attempts >= 20) {
        setAwaiting(false);
        setMessage(
          "Approval sent. If the CLI has not completed registration, check it and refresh this list.",
        );
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [awaiting]);
  async function inspect(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    setRequest(null);
    try {
      setRequest(
        await api("/devices/inspect", { code: code.toUpperCase().trim() }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function decide(approve: boolean) {
    setBusy(true);
    setError("");
    try {
      await api("/devices/approve", { code: request!.userCode, approve });
      setRequest(null);
      setCode("");
      setMessage(
        approve
          ? "Approved. Your harness will finish connecting on its next poll."
          : "Device request denied.",
      );
      setAwaiting(approve);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ErrorBox error={error} />
      {message && <div className="success spaced">{message}</div>}
      <div className="page-action-row">
        <p className="muted">
          Connect a device, then share one reviewed setup snapshot. Measuring
          usage is optional.
        </p>
        <div className="row-actions">
          {activeDevices.length > 0 && (
            <button
              className="button primary"
              onClick={() => go("/setups?share=1")}
            >
              Share a setup once
            </button>
          )}
          <button
            className={`button ${activeDevices.length ? "secondary" : "primary"}`}
            onClick={() => setShowInstructions(true)}
          >
            {activeDevices.length ? "Connect another device" : "Connect a device"}
          </button>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Device authorization and sync</h2>
            <p>
              Authorization, synced metadata, and local source checks are
              separate states.
            </p>
          </div>
          <button
            className="text-button"
            onClick={() => reload().catch((e) => setError(e.message))}
          >
            Refresh
          </button>
        </div>
        <div className="panel-body">
          {devices.length ? (
            devices.map((d) => (
              <div className="device-card" key={d.tokenId}>
                <Monitor size={22} />
                <div>
                  <strong>
                    {d.label}{" "}
                    {d.revokedAt ? (
                      <span className="badge red">Revoked</span>
                    ) : Date.parse(d.expiresAt) <= Date.now() ? (
                      <span className="badge amber">Expired</span>
                    ) : (
                      <span className="badge green">Authorized</span>
                    )}
                  </strong>
                  <small>
                    {d.lastUsedAt
                      ? `Last authenticated request ${date(d.lastUsedAt)}`
                      : "Not used yet"}{" "}
                    · Expires {date(d.expiresAt)} · {short(d.tokenId)}
                  </small>
                  <div className="device-health">
                    <p>
                      <strong>Last successful sync:</strong>{" "}
                      {d.syncedAt ? date(d.syncedAt) : "Not reported"}
                    </p>
                    {d.sync ? (
                      <>
                        <p>
                          {d.sync.pendingRuns} finalized runs pending ·{" "}
                          {d.sync.unpublishedSetups} saved setups not published
                          by you
                        </p>
                        <p>
                          <strong>Configuration check:</strong>{" "}
                          {d.sync.changedSources} changed sources ·{" "}
                          {d.sync.uncheckedSources} unchecked / unavailable{" "}
                          {d.sync.sourceCheckedAt
                            ? `· checked ${date(d.sync.sourceCheckedAt)}`
                            : ""}
                        </p>
                        <p>
                          Collector {d.sync.collector} at last sync. This is a
                          device report, not a live connection.
                        </p>
                      </>
                    ) : (
                      <p>
                        Run team sync with this workspace’s remote and scope to
                        report metadata status. Add --check to inspect saved
                        capture sources locally.
                      </p>
                    )}
                  </div>
                </div>
                <button
                  className="text-button"
                  onClick={() => setShowInstructions(true)}
                >
                  {d.revokedAt || Date.parse(d.expiresAt) <= Date.now()
                    ? "Reconnect"
                    : "Renew login"}
                </button>
                {!d.revokedAt && (
                  <button className="text-button" onClick={() => setRevoke(d)}>
                    Revoke
                  </button>
                )}
              </div>
            ))
          ) : (
            <Empty title="No devices connected">
              Connect a harness to register a device. Capture and sync remain
              separate actions.
            </Empty>
          )}
        </div>
      </section>
      <SharingNotice />
      <div className="page-grid spaced">
        <section className="panel">
          <div className="panel-heading">
            <h2>Check and share changes</h2>
          </div>
          <div className="panel-body">
            <ol className="flow-steps">
              <li>
                Run <code>loadout setup check --scope {team.scope}</code> to
                detect changes in locally captured sources.
              </li>
              <li>
                Capture and inspect a new revision when you want to share an
                edit.
              </li>
              <li>
                Publish the reviewed setup. Run{" "}
                <code>
                  loadout team sync {team.teamName} --scope {team.scope}
                </code>{" "}
                separately for finalized measurements.
              </li>
            </ol>
            <p className="muted">
              Watch sync can check saved capture sources with --check. It never
              publishes configuration automatically.
            </p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Approve a device</h2>
              <p>Enter the code shown by your local harness</p>
            </div>
            <ShieldCheck size={19} />
          </div>
          <div className="panel-body">
            <form onSubmit={inspect} className="stack">
              <Field label="Device code">
                <input
                  className="device-code"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setRequest(null);
                  }}
                  pattern="[A-Fa-f0-9]{5}-[A-Fa-f0-9]{5}"
                  maxLength={11}
                  placeholder="ABCDE-12345"
                  required
                  autoComplete="off"
                />
              </Field>
              <button className="button secondary" disabled={busy}>
                Check device
              </button>
            </form>
            {request && (
              <div className="approval">
                <h3>{request.label}</h3>
                <p>
                  <code>{request.userCode}</code>
                  <br />
                  Expires {date(request.expiresAt)}
                </p>
                {request.approvedBy || request.deniedAt ? (
                  <p>This request has already been handled.</p>
                ) : (
                  <>
                    <p>
                      Approve only if this code matches the one on the device
                      you are connecting.
                    </p>
                    <div className="row-actions">
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() => decide(true)}
                      >
                        Approve device
                      </button>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => decide(false)}
                      >
                        Deny
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
      <section className="panel spaced">
        <div className="panel-heading">
          <div>
            <h2>Optional usage collection</h2>
            <p>Measure a chosen workflow only when you want usage data.</p>
          </div>
          <button className="button secondary" onClick={() => setMeasure("1")}>
            Set up measurement
          </button>
        </div>
      </section>
      {measure === "1" && (
        <Modal
          title="Measure your first workflow"
          close={() => setMeasure(null)}
          wide
        >
          <div className="modal-body measurement-onboarding">
            <div
              className="measurement-harnesses"
              role="group"
              aria-label="Harness to measure"
            >
              {(["pi", "claude-code", "codex"] as Harness[]).map(
                (harness) => (
                  <button
                    type="button"
                    key={harness}
                    aria-pressed={measurementHarness === harness}
                    onClick={() => setMeasurementHarness(harness)}
                  >
                    <HarnessLabel harness={harness} />
                  </button>
                ),
              )}
            </div>
            <div className="measurement-guide">
              <div>
                <h3>Collect only the workflow you choose</h3>
                <p>
                  Start collection before the work, finalize it locally, then
                  sync. Loadout does not import earlier sessions.
                </p>
                <Copy
                  text={measurementInstructions}
                  label="Copy measurement instructions"
                />
              </div>
              <pre>{measurementInstructions}</pre>
            </div>
          </div>
        </Modal>
      )}
      {showInstructions && (
        <Modal
          title={
            activeDevices.length
              ? "Connect or renew a device"
              : "Connect your first device"
          }
          close={() => setShowInstructions(false)}
          compact
        >
          <div className="modal-body">
            <p>
              Give the instructions below to your local Pi, Claude Code, or
              Codex agent. They guide one-time setup sharing after you approve
              the device.
            </p>
            {instructions ? (
              <Copy text={instructions} label="Copy agent instructions" primary />
            ) : (
              <p>Loading instructions…</p>
            )}
            <details className="spaced">
              <summary>Manual login command</summary>
              <pre>{loginCommand}</pre>
              <Copy text={loginCommand} label="Copy login command" />
            </details>
            <p className="spaced">
              Open the approval link printed by the CLI and confirm its device
              code here. Then check the connection with{" "}
              <code>
                loadout team status {team.teamName} --scope {team.scope}
              </code>
              . The copied agent instructions then guide a one-time setup capture
              and review. Nothing is published until you approve the snapshot.
            </p>
            <details className="spaced">
              <summary>Read agent instructions</summary>
              <pre>{instructions || "Loading instructions…"}</pre>
            </details>
          </div>
        </Modal>
      )}
      {revoke && (
        <Modal
          title="Disconnect this device?"
          close={() => setRevoke(null)}
          compact
        >
          <div className="modal-body">
            <p>
              Revoke access for <strong>{revoke.label}</strong>. Its local files
              stay on that device. It will need a new device login to reconnect.
            </p>
            <div className="modal-actions">
              <button className="button" onClick={() => setRevoke(null)}>
                Cancel
              </button>
              <button
                className="button danger"
                onClick={() =>
                  api("/devices/revoke", { tokenId: revoke.tokenId })
                    .then(() => {
                      setRevoke(null);
                      return reload();
                    })
                    .catch((e) => setError(e.message))
                }
              >
                Revoke device
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

type Invite = {
  challengeId: string;
  email: string;
  actorId: string;
  role: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
};
type TeamInviteLink = {
  linkId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  useCount: number;
  createdBy: string;
};
export function TeamAccess({ user }: { user: WebUser }) {
  const [users, setUsers] = useState<WebUser[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [links, setLinks] = useState<TeamInviteLink[]>([]);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState(false);
  const [createLink, setCreateLink] = useState(false);
  const [link, setLink] = useState<{
    url: string;
    expiresAt: string;
    kind: string;
    multiUse?: boolean;
  } | null>(null);
  const [action, setAction] = useState<{
    target: WebUser;
    role?: "admin" | "member";
    disabled?: boolean;
  } | null>(null);
  const reload = async () => {
    const request = api<{ links: TeamInviteLink[] }>("/invite-links").then((r) => setLinks(r.links));
    if (user.role === "admin") {
      const admin = api<{ users: WebUser[]; invitations: Invite[] }>("/admin/team").then((r) => {
        setUsers(r.users);
        setInvites(r.invitations);
      });
      await Promise.all([request, admin]);
    } else await request;
  };
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);
  const pending = invites.filter(
    (i) =>
      !i.consumedAt && !i.revokedAt && Date.parse(i.expiresAt) > Date.now(),
  );
  const activeLinks = links.filter((i) => !i.revokedAt && Date.parse(i.expiresAt) > Date.now());
  return (
    <>
      <ErrorBox error={error} />
      <section className="panel">
        <div className="panel-heading team-invite-heading">
          <div>
            <h2>Team invitation links <span className="badge">{activeLinks.length} active</span></h2>
            <p>Share one link with several teammates. Each person joins as a member before it expires. Copy the link when created; it cannot be shown again.</p>
          </div>
          <button className="button primary" onClick={() => setCreateLink(true)}>
            <Plus size={15} /> Create link
          </button>
        </div>
        {links.length ? (
          <div className="table-wrap">
            <table className="team-invite-table">
              <thead><tr><th>Created by</th><th>Expires</th><th>Joined</th><th>Status</th><th /></tr></thead>
              <tbody>
                {links.map((item) => {
                  const status = item.revokedAt ? "Revoked" : Date.parse(item.expiresAt) <= Date.now() ? "Expired" : "Active";
                  return (
                    <tr key={item.linkId}>
                      <td data-label="Created by">{item.createdBy === user.actorId ? "You" : item.createdBy}</td>
                      <td data-label="Expires">{date(item.expiresAt)}</td>
                      <td data-label="Joined">{item.useCount}</td>
                      <td data-label="Status"><span className={`badge ${status === "Active" ? "green" : ""}`}>{status}</span></td>
                      <td className="team-invite-action">{status === "Active" && (user.role === "admin" || item.createdBy === user.actorId) ? (
                        <button className="text-button" onClick={() => api("/invite-links/revoke", { linkId: item.linkId }).then(reload).catch((e) => setError(e.message))}>Revoke</button>
                      ) : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="inline-empty">No invitation links yet. Create one, then share it privately with your team.</div>
        )}
      </section>
      {user.role === "admin" && <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              Members <span className="badge">{users.length}</span>
            </h2>
            <p>
              Admins manage accounts. Members share setups and review activity.
            </p>
          </div>
          <button className="button" onClick={() => setInvite(true)}>
            <Plus size={15} />
            Invite one person
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Handle</th>
                <th>Role</th>
                <th>Status</th>
                <th>Manage</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId}>
                  <td>
                    <strong>
                      {u.name}
                      {u.userId === user.userId ? " (you)" : ""}
                    </strong>
                    <span className="table-sub">{u.email}</span>
                  </td>
                  <td>
                    <code>{u.actorId}</code>
                  </td>
                  <td>
                    <span className="badge">{u.role}</span>
                  </td>
                  <td>
                    <span className={`badge ${u.disabledAt ? "red" : "green"}`}>
                      {u.disabledAt ? "Disabled" : "Active"}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="text-button"
                        onClick={() =>
                          setAction({
                            target: u,
                            role: u.role === "admin" ? "member" : "admin",
                          })
                        }
                      >
                        {u.role === "admin" ? "Make member" : "Make admin"}
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          setAction({ target: u, disabled: !u.disabledAt })
                        }
                      >
                        {u.disabledAt ? "Enable" : "Disable"}
                      </button>
                      {!u.disabledAt && (
                        <button
                          className="text-button"
                          onClick={() =>
                            api("/admin/reset-link", { userId: u.userId })
                              .then((r) =>
                                setLink({ ...r, kind: "Password reset" }),
                              )
                              .catch((e) => setError(e.message))
                          }
                        >
                          Reset link
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              Pending invitations{" "}
              <span className="badge">{pending.length}</span>
            </h2>
            <p>
              Single-use links expire after 7 days. Share them directly with the
              intended person.
            </p>
          </div>
        </div>
        {pending.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Handle</th>
                  <th>Role</th>
                  <th>Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pending.map((i) => (
                  <tr key={i.challengeId}>
                    <td>{i.email}</td>
                    <td>
                      <code>{i.actorId}</code>
                    </td>
                    <td>{i.role}</td>
                    <td>{date(i.expiresAt)}</td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() =>
                          api("/admin/invitations/revoke", {
                            challengeId: i.challengeId,
                          })
                            .then(reload)
                            .catch((e) => setError(e.message))
                        }
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="inline-empty">No pending invitations.</div>
        )}
      </section>
      <WorkspaceOperations />
      </>}
      {createLink && (
        <TeamInviteLinkForm
          close={() => setCreateLink(false)}
          saved={async (r) => {
            setCreateLink(false);
            setLink({ ...r, kind: "Team invitation", multiUse: true });
            await reload();
          }}
        />
      )}
      {invite && (
        <InviteForm
          close={() => setInvite(false)}
          saved={async (r) => {
            setInvite(false);
            setLink({ ...r, kind: "Invitation" });
            await reload();
          }}
        />
      )}
      {link && (
        <Modal
          title={`${link.kind} link ready`}
          close={() => setLink(null)}
          compact
        >
          <div className="modal-body">
            <p>
              {link.multiUse
                ? `Share this link privately with teammates. Multiple people can join as members until ${date(link.expiresAt)}.`
                : `Share this link privately with the intended recipient. It can be used once and expires ${date(link.expiresAt)}.`}
              {" "}Copy it now; the server keeps only its hash.
            </p>
            <pre>{link.url}</pre>
            <Copy text={link.url} label="Copy private link" />
            <p className="muted spaced">
              No email has been sent. Harness connection instructions are
              available separately under My devices.
            </p>
          </div>
        </Modal>
      )}
      {action && (
        <Modal
          title={
            action.role
              ? `Change role to ${action.role}?`
              : action.disabled
                ? "Disable this account?"
                : "Enable this account?"
          }
          close={() => setAction(null)}
          compact
        >
          <div className="modal-body">
            <p>
              <strong>{action.target.name}</strong> ({action.target.email}){" "}
              {action.role
                ? `will become a ${action.role}.`
                : action.disabled
                  ? "will lose account access and all connected device credentials will be revoked."
                  : "will be able to sign in again. Revoked credentials remain revoked."}
            </p>
            {action.role === "admin" && (
              <p className="muted spaced">
                Admins can invite or disable members and issue password reset
                links.
              </p>
            )}
            <div className="modal-actions">
              <button className="button" onClick={() => setAction(null)}>
                Cancel
              </button>
              <button
                className="button primary"
                onClick={() =>
                  api("/admin/users", {
                    userId: action.target.userId,
                    ...(action.role
                      ? { role: action.role }
                      : { disabled: action.disabled }),
                  })
                    .then(() => {
                      setAction(null);
                      return reload();
                    })
                    .catch((e) => {
                      setAction(null);
                      setError(e.message);
                    })
                }
              >
                Confirm change
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
function localDateTime(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
function TeamInviteLinkForm({
  close,
  saved,
}: {
  close: () => void;
  saved: (value: { url: string; expiresAt: string }) => Promise<void>;
}) {
  const [bounds] = useState(() => {
    const now = Date.now();
    return {
      min: localDateTime(new Date(now + 6 * 60_000)),
      initial: localDateTime(new Date(now + 7 * 86_400_000)),
      max: localDateTime(new Date(now + 30 * 86_400_000 - 60_000)),
    };
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const raw = new FormData(e.currentTarget).get("expiresAt");
      const expiry = new Date(String(raw));
      if (Number.isNaN(expiry.getTime())) throw new Error("Choose a valid expiry date and time.");
      await saved(await api("/invite-links", { expiresAt: expiry.toISOString() }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Create team invitation link" close={close} compact>
      <form onSubmit={submit} className="modal-body">
        <p className="muted">Anyone with this link can create a member account until it expires. Share it only with teammates.</p>
        <Field label="Link expires" hint="Choose a time within the next 30 days.">
          <input name="expiresAt" type="datetime-local" min={bounds.min} max={bounds.max} defaultValue={bounds.initial} required />
        </Field>
        <ErrorBox error={error} />
        <div className="modal-actions">
          <button className="button" type="button" onClick={close}>Cancel</button>
          <button className="button primary" disabled={busy}>{busy ? "Creating…" : "Create link"}</button>
        </div>
      </form>
    </Modal>
  );
}
function InviteForm({
  close,
  saved,
}: {
  close: () => void;
  saved: (value: { url: string; expiresAt: string }) => Promise<void>;
}) {
  const [handle, setHandle] = useState("");
  const [customHandle, setCustomHandle] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await saved(
        await api(
          "/admin/invitations",
          Object.fromEntries(new FormData(e.currentTarget)),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Invite a teammate" close={close} compact>
      <form onSubmit={submit} className="modal-body">
        <p className="muted">
          Choose their role and stable member handle. They will set their own
          password using a private invitation link.
        </p>
        <Field label="Email address">
          <input
            name="email"
            onChange={(e) => {
              if (!customHandle)
                setHandle(
                  e.target.value
                    .split("@")[0]
                    .toLowerCase()
                    .replace(/[^a-z0-9._-]/g, "")
                    .replace(/^[^a-z0-9]+/, "")
                    .slice(0, 80),
                );
            }}
            type="email"
            autoComplete="off"
            required
            maxLength={254}
            placeholder="teammate@company.com"
          />
        </Field>
        <Field
          label="Member handle"
          hint="Keep this consistent with their existing Loadout actor, if they already have one."
        >
          <input
            name="actorId"
            value={handle}
            onChange={(e) => {
              setCustomHandle(true);
              setHandle(e.target.value);
            }}
            pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{0,79}"
            required
            maxLength={80}
            placeholder="e.g. sam"
          />
        </Field>
        <Field label="Role">
          <select name="role">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <ErrorBox error={error} />
        <div className="modal-actions">
          <button className="button" type="button" onClick={close}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Creating…" : "Create invitation link"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
