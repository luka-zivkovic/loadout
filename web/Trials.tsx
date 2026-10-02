import { useEffect, useState } from "react";
import type { WebUser } from "../src/web-auth";
import type { Trial } from "../src/operations";
import type { Assessment, Metrics } from "../src/schema";
import type { ProfileListing } from "../src/team-protocol";
import {
  api,
  Copy,
  date,
  Empty,
  ErrorBox,
  Field,
  Modal,
  short,
  type Dashboard,
} from "./shared";
import { SetupDiff, refKey } from "./Artifacts";
import { go, useParam } from "./navigation";
import { ComparisonTable, RunDetail } from "./Views";
import { HarnessLabel } from "./HarnessIcon";
import {
  hasComparableSetups,
  supportsSetupComparison,
} from "../src/onboarding";

const ref = (p: ProfileListing) => ({
  owner: p.owner,
  name: p.name,
  revision: p.revision,
});
const label = (p: ProfileListing) =>
  `${p.owner} / ${p.name} · ${short(p.revision)}`;
export function Trials({
  data,
  user,
  refresh,
}: {
  data: Dashboard;
  user: WebUser;
  refresh: () => Promise<unknown>;
}) {
  const [creating, setCreating] = useParam("new");
  const [trialId, setTrialId] = useParam("trial");
  const [comparisonId, setComparisonId] = useParam("comparison");
  const comparable = hasComparableSetups(data.profiles);
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Setup comparisons</h2>
            <p>Inspect → try locally → assess → decide</p>
          </div>
          <button
            className="button primary"
            onClick={() =>
              comparable ? setCreating("1") : go("/setups?share=1")
            }
          >
            {comparable ? "New comparison" : "Share a comparable setup"}
          </button>
        </div>
        {data.trials.length ? (
          <div className="trial-list">
            {data.trials.map((t) => (
              <button
                className="trial-row"
                key={t.trialId}
                onClick={() => setTrialId(t.trialId)}
              >
                <div>
                  <strong>{t.name}</strong>
                  <span>
                    {t.baseline.name} → {t.candidate.name}
                  </span>
                </div>
                <div>
                  <span className={`badge ${t.conclusion ? "green" : "amber"}`}>
                    {t.conclusion?.replaceAll("-", " ") ??
                      "Awaiting evaluation"}
                  </span>
                  <small>
                    {t.kind === "controlled"
                      ? "Pi · frozen context"
                      : "Native usage observations"}{" "}
                    · {date(t.createdAt)}
                  </small>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Empty
            title="Try one colleague’s setup"
            action={
              <button
                className="button secondary"
                onClick={() =>
                  comparable ? setCreating("1") : go("/setups?share=1")
                }
              >
                {comparable ? "Choose two revisions" : "Share a comparable setup"}
              </button>
            }
          >
            Comparisons support Pi, Claude Code, and Codex setups with the same
            harness and workflow. Task context and review output stay local.
          </Empty>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Synced comparison runs</h2>
            <p>
              Complete run groups; the period filter selects whole comparisons,
              not individual runs.
            </p>
          </div>
        </div>
        {data.comparisons.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Comparison</th>
                  <th>Setups</th>
                  <th>Runs</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {data.comparisons.map((c) => (
                  <tr key={c.comparisonId}>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => setComparisonId(c.comparisonId)}
                      >
                        {short(c.comparisonId)}
                      </button>
                      <small className="table-sub">{date(c.startedAt)}</small>
                    </td>
                    <td>{c.setups}</td>
                    <td>{c.runs}</td>
                    <td>
                      {c.frozenRuns === c.runs && c.contexts === 1
                        ? "Same frozen context"
                        : c.frozenRuns === c.runs
                          ? "Different frozen contexts"
                          : "Includes unmeasured / interactive context"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="inline-empty">
            No synced comparison runs in this period.
          </div>
        )}
      </section>
      {creating && (
        <TrialWizard
          data={data}
          user={user}
          refresh={refresh}
          close={() => setCreating(null)}
        />
      )}
      {trialId && (
        <TrialDetail
          trialId={trialId}
          data={data}
          user={user}
          refresh={refresh}
          close={() => setTrialId(null)}
        />
      )}
      {comparisonId && (
        <ExperimentDetail
          comparisonId={comparisonId}
          user={user}
          close={() => setComparisonId(null)}
        />
      )}
    </>
  );
}
function TrialWizard({
  data,
  user,
  refresh,
  close,
}: {
  data: Dashboard;
  user: WebUser;
  refresh: () => Promise<unknown>;
  close: () => void;
}) {
  const [candidateParam] = useParam("candidate");
  const suggestedCandidate =
    data.profiles.find(
      (p) =>
        p.owner !== user.actorId &&
        supportsSetupComparison(p.harness?.kind ?? "pi"),
    ) ??
    data.profiles.find((p) =>
      supportsSetupComparison(p.harness?.kind ?? "pi"),
    );
  const [candidateKey, setCandidate] = useState(
    candidateParam || (suggestedCandidate ? refKey(suggestedCandidate) : ""),
  );
  const [history, setHistory] = useState<ProfileListing[]>([]);
  const [historyError, setHistoryError] = useState("");
  useEffect(() => {
    let live = true;
    setHistory([]);
    setHistoryError("");
    const [owner, name] = candidateKey.split("/");
    if (owner && name)
      api(
        `/artifacts/profile/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/history`,
      )
        .then((r) => {
          if (live)
            setHistory(
              r.history.filter(
                (
                  p: ProfileListing & {
                    withdrawnAt: string | null;
                    blockedSkills: string[];
                  },
                ) => !p.withdrawnAt && !p.blockedSkills.length,
              ),
            );
        })
        .catch((e) => {
          if (live) setHistoryError(e.message);
        });
    return () => {
      live = false;
    };
  }, [candidateKey]);
  const catalogue = [
    ...data.profiles,
    ...history.filter(
      (p) => !data.profiles.some((head) => refKey(head) === refKey(p)),
    ),
  ];
  const candidate = catalogue.find((p) => refKey(p) === candidateKey);
  const eligible = catalogue.filter(
    (p) =>
      supportsSetupComparison(p.harness?.kind ?? "pi") &&
      p.revision !== candidate?.revision &&
      (!candidate ||
        ((p.harness?.kind ?? "pi") === (candidate.harness?.kind ?? "pi") &&
          p.workflowId === candidate.workflowId)),
  );
  const [baselineKey, setBaseline] = useState("");
  const baseline =
    eligible.find((p) => refKey(p) === baselineKey) ??
    eligible.find((p) => p.owner === user.actorId);
  const [name, setName] = useState("Review setup comparison");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Compare with a teammate" close={close}>
      <form
        className="modal-body"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!baseline || !candidate) return;
          setBusy(true);
          setError("");
          try {
            const r = await api("/trials", {
              name,
              baseline: ref(baseline),
              candidate: ref(candidate),
            });
            await refresh();
            go(`/comparisons?trial=${r.trial.trialId}`);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          Pick two Pi, Claude Code, or Codex revisions with the same harness
          and workflow. Inspect their differences before preparing a local
          comparison.
        </p>
        <Field
          label="Comparison label"
          hint="Visible to the workspace. Use a reusable label; keep task names, code, and repository paths local."
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
          />
        </Field>
        <div className="form-grid">
          <Field label="Teammate / candidate setup">
            <select
              value={candidateKey}
              onChange={(e) => {
                setCandidate(e.target.value);
                setBaseline("");
              }}
              required
            >
              <option value="">Choose candidate</option>
              {catalogue.map((p) => (
                <option
                  key={refKey(p)}
                  value={refKey(p)}
                  disabled={!supportsSetupComparison(p.harness?.kind ?? "pi")}
                >
                  {label(p)}
                  {!supportsSetupComparison(p.harness?.kind ?? "pi")
                    ? " · sharing only"
                    : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Baseline setup">
            <select
              value={baseline ? refKey(baseline) : ""}
              onChange={(e) => setBaseline(e.target.value)}
              required
            >
              <option value="">Choose baseline</option>
              {eligible.map((p) => (
                <option key={refKey(p)} value={refKey(p)}>
                  {label(p)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="text-small muted">
          The selected setup’s available revision history is included. Withdrawn
          revisions and blocked dependencies cannot be tried.
        </p>
        <ErrorBox error={historyError} />
        {!eligible.length && (
          <p className="notice">
            {candidate && !supportsSetupComparison(candidate.harness?.kind ?? "pi")
              ? "This setup can be shared, but comparisons currently support Pi, Claude Code, and Codex only. Choose a supported candidate."
              : "Publish a second Pi, Claude Code, or Codex revision with the same harness and workflow first. Individual skills can be shared across harnesses."}
          </p>
        )}
        {baseline && candidate && (
          <>
            <div className="notice">
              {(candidate.harness?.kind ?? "pi") === "pi"
                ? "Pi can run both revisions against the same locally frozen packet. You will review the outputs locally and share assessment counts."
                : "Native comparisons collect usage observations. Task context, effective configuration, and review quality are not automatically verified."}
            </div>
            <SetupDiff baseline={baseline} candidate={candidate} />
          </>
        )}
        <ErrorBox error={error} />
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !baseline || !candidate}
          >
            {busy ? "Creating…" : "Create local comparison handoff"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function TrialDetail({
  trialId,
  data,
  user,
  refresh,
  close,
}: {
  trialId: string;
  data: Dashboard;
  user: WebUser;
  refresh: () => Promise<unknown>;
  close: () => void;
}) {
  const [result, setResult] = useState<{
    trial: Trial;
    records: Metrics[];
    assessments: Assessment[];
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Metrics | null>(null);
  const load = async () => {
    const r = await api(`/trials/${encodeURIComponent(trialId)}`);
    setResult(r);
  };
  useEffect(() => {
    let live = true;
    const update = () =>
      api(`/trials/${encodeURIComponent(trialId)}`)
        .then((r) => {
          if (live) {
            setResult(r);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    void update();
    const timer = setInterval(() => {
      if (!document.hidden) void update();
    }, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [trialId]);
  const trial = result?.trial;
  const command = `loadout team trial ${data.team.teamName} ${trialId} --scope ${data.team.scope}`;
  const comparisonUrl = `${location.origin}/comparisons?trial=${encodeURIComponent(trialId)}`;
  const handoff = trial
    ? `Prepare the Loadout comparison “${trial.name}” using my installed local harness. Use the locally installed loadout CLI; if missing, use node /path/to/pi-share/dist/cli.js from the Loadout repository. Use my existing remote alias if it differs from ${data.team.teamName}.\n\n${trial.kind === "controlled" ? `Ask me to choose the local repository and base/head Git refs. Inspect the pinned baseline and candidate, then prepare their shared local packet with:\n${command} --repo /path/to/repository --base BASE_REF --head HEAD --prepare-only\n\nShow requirements and any configuration differences. After I choose to run the comparison, repeat that command without --prepare-only. It runs both Pi setups with read-only tools and syncs metadata. Read generated reviews locally and help me enter assessment counts.` : `Run:\n${command} --prepare-only\n\nInspect the two exported native configurations and their requirements. Use each printed directory with the matching native harness and my own local authentication. Run the collector commands printed by preparation with the same --comparison ID. Choose the task locally. Stop each collector after the harness exits, then run:\nloadout team sync ${data.team.teamName} --scope ${data.team.scope}\n\nThese are observations, not a controlled equal-context comparison. Explain missing measurements and do not infer a winner from cost alone.`}\n\nKeep repository paths, code, prompts, tool output, and reviews local. Return to ${comparisonUrl} to evaluate and record a decision.`
    : "";
  return (
    <Modal title={trial?.name ?? "Loading comparison…"} close={close}>
      <div className="modal-body">
        <ErrorBox error={error} />
        {trial && result && (
          <>
            <div className="trial-progress" aria-label="Comparison progress">
              <span className="complete">1 · Revisions selected</span>
              <span className={result.records.length ? "complete" : ""}>
                2 ·{" "}
                {result.records.length
                  ? `${result.records.length} runs synced`
                  : "Try locally"}
              </span>
              <span className={trial.conclusion ? "complete" : ""}>
                3 ·{" "}
                {trial.conclusion?.replaceAll("-", " ") ??
                  "Evaluate and decide"}
              </span>
            </div>
            <p className="text-small muted">
              {trial.kind === "controlled"
                ? "Pi controlled comparison · task packet stays local"
                : "Native observations · context unmeasured"}{" "}
              · by {trial.owner}
            </p>
            <details open={!result.records.length} className="spaced">
              <summary>Local handoff and requirements</summary>
              <pre>{handoff}</pre>
              <Copy text={handoff} label="Copy harness instructions" />
              <details className="spaced">
                <summary>Inspect pinned differences</summary>
                <SetupDiff
                  baseline={trial.baseline}
                  candidate={trial.candidate}
                />
              </details>
            </details>
            <h3 className="section-title">Results</h3>
            {result.records.length ? (
              <>
                <ComparisonTable
                  runs={result.records}
                  events={result.assessments}
                />
                <div className="row-actions spaced">
                  {result.records.map((r) => (
                    <button
                      className="button secondary"
                      key={r.runId}
                      onClick={() => setDetail(r)}
                    >
                      {r.source === "runner" && r.status === "completed"
                        ? "Assess"
                        : "Inspect"}{" "}
                      {r.profileName} · {short(r.runId)}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">
                Waiting for local execution and metadata sync. This view checks
                for results automatically.
              </p>
            )}
            <h3 className="section-title">Decision</h3>
            <p className="muted">
              Record your judgement after inspecting local outputs. Insufficient
              evidence is a valid result; usage alone does not establish
              quality.
            </p>
            {trial.owner === user.actorId ? (
              <Field label="Comparison decision">
                <select
                  value={trial.conclusion ?? ""}
                  disabled={busy}
                  onChange={async (e) => {
                    if (!e.target.value) return;
                    setBusy(true);
                    setError("");
                    try {
                      await api(`/trials/${trialId}/conclusion`, {
                        conclusion: e.target.value,
                      });
                      await load();
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <option value="">Choose after evaluation</option>
                  <option value="insufficient-evidence">
                    Insufficient evidence
                  </option>
                  <option value="keep-baseline">Keep baseline</option>
                  <option value="adopt-candidate">Adopt candidate</option>
                </select>
              </Field>
            ) : (
              <p>
                {trial.conclusion?.replaceAll("-", " ") ??
                  "The comparison owner has not recorded a decision."}
              </p>
            )}
            <Copy
              text={comparisonUrl}
              label="Copy comparison link"
            />
          </>
        )}
        {detail && result && (
          <RunDetail
            run={detail}
            events={result.assessments}
            user={user}
            refresh={load}
            close={() => setDetail(null)}
          />
        )}
      </div>
    </Modal>
  );
}
export function ExperimentDetail({
  comparisonId,
  user,
  close,
}: {
  comparisonId: string;
  user: WebUser;
  close: () => void;
}) {
  const [result, setResult] = useState<{
    records: Metrics[];
    assessments: Assessment[];
  } | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Metrics | null>(null);
  const load = async () =>
    setResult(await api(`/comparisons/${encodeURIComponent(comparisonId)}`));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [comparisonId]);
  return (
    <Modal title={`Comparison ${short(comparisonId)}`} close={close}>
      <div className="modal-body">
        <ErrorBox error={error} />
        {result && (
          <>
            <ComparisonTable
              runs={result.records}
              events={result.assessments}
            />
            <div className="row-actions spaced">
              {result.records.map((r) => (
                <button
                  className="button secondary"
                  key={r.runId}
                  onClick={() => setSelected(r)}
                >
                  Inspect / assess {short(r.runId)}
                </button>
              ))}
            </div>
            <Copy text={location.href} label="Copy comparison link" />
          </>
        )}
        {selected && result && (
          <RunDetail
            run={selected}
            events={result.assessments}
            user={user}
            refresh={load}
            close={() => setSelected(null)}
          />
        )}
      </div>
    </Modal>
  );
}
