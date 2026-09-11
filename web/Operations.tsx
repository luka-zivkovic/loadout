import { useEffect, useState } from "react";
import { api, date, ErrorBox, Field, Modal, short } from "./shared";

type Limits = {
  maxStorageMb: number;
  maxRuns: number;
  withdrawalRetentionDays: number;
};
type Data = {
  events: {
    eventId: number;
    actor: string;
    action: string;
    target: string;
    createdAt: string;
  }[];
  usage: { bytes: number; runs: number; limits: Limits };
  withdrawals: unknown[];
  devices: {
    tokenId: string;
    actorId: string;
    label: string | null;
    expiresAt: string;
    revokedAt: string | null;
    syncedAt: string | null;
  }[];
};
export function WorkspaceOperations() {
  const [data, setData] = useState<Data | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [purge, setPurge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revoke, setRevoke] = useState<Data["devices"][number] | null>(null);
  const reload = async () => {
    const r = await api<Data>("/admin/operations");
    setData(r);
    setLimits(r.usage.limits);
  };
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Workspace operations</h2>
            <p>Storage policy, member devices, and administrative events.</p>
          </div>
          <button
            className="text-button"
            onClick={() => reload().catch((e) => setError(e.message))}
          >
            Refresh operations
          </button>
        </div>
        <div className="panel-body">
          <ErrorBox error={error} />
          {message && (
            <p className="success" role="status">
              {message}
            </p>
          )}
          {data && limits && (
            <>
              <div className="operational-stats">
                <p>
                  <strong>
                    {(data.usage.bytes / 1_000_000).toFixed(1)} MB
                  </strong>{" "}
                  stored payloads / {limits.maxStorageMb} MB quota
                </p>
                <p>
                  <strong>{data.usage.runs.toLocaleString()}</strong> runs /{" "}
                  {limits.maxRuns.toLocaleString()}
                </p>
              </div>
              <details>
                <summary>Storage and withdrawal retention</summary>
                <form
                  className="spaced"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError("");
                    try {
                      await api("/admin/limits", limits);
                      await reload();
                      setMessage(
                        "Storage policy saved. Existing content was not deleted.",
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <div className="form-grid">
                    <Field label="Payload quota (MB)">
                      <input
                        type="number"
                        required
                        min={10}
                        max={1000000}
                        value={limits.maxStorageMb}
                        onChange={(e) =>
                          setLimits({
                            ...limits,
                            maxStorageMb: Number(e.target.value),
                          })
                        }
                      />
                    </Field>
                    <Field label="Maximum runs">
                      <input
                        type="number"
                        required
                        min={100}
                        max={10000000}
                        value={limits.maxRuns}
                        onChange={(e) =>
                          setLimits({
                            ...limits,
                            maxRuns: Number(e.target.value),
                          })
                        }
                      />
                    </Field>
                    <Field label="Days to retain withdrawn content">
                      <input
                        type="number"
                        required
                        min={0}
                        max={3650}
                        value={limits.withdrawalRetentionDays}
                        onChange={(e) =>
                          setLimits({
                            ...limits,
                            withdrawalRetentionDays: Number(e.target.value),
                          })
                        }
                      />
                    </Field>
                  </div>
                  <button className="button secondary" disabled={busy}>
                    Save policy
                  </button>
                </form>
                <p className="muted spaced">
                  Withdrawal blocks downloads immediately. Purging removes
                  eligible server content after the retention period. Backups
                  and copies on other devices require their own retention
                  process. Quotas measure stored payloads, not the SQLite file
                  size.
                </p>
                <button
                  className="button danger spaced"
                  onClick={() => setPurge(true)}
                >
                  Purge eligible withdrawn content
                </button>
              </details>
              <details className="spaced">
                <summary>Member devices · {data.devices.length}</summary>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Member / device</th>
                        <th>Access</th>
                        <th>Last sync</th>
                        <th>Manage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.devices.map((d) => (
                        <tr key={d.tokenId}>
                          <td>
                            {d.actorId}
                            <span className="table-sub">
                              {d.label ?? "CLI credential"} · {short(d.tokenId)}
                            </span>
                          </td>
                          <td>
                            {d.revokedAt
                              ? "Revoked"
                              : Date.parse(d.expiresAt) <= Date.now()
                                ? "Expired"
                                : "Authorized"}
                          </td>
                          <td>
                            {d.syncedAt ? date(d.syncedAt) : "Not reported"}
                          </td>
                          <td>
                            {!d.revokedAt && (
                              <button
                                className="text-button"
                                onClick={() => setRevoke(d)}
                              >
                                Revoke access
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <h3 className="section-title">Administrative events</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.map((e) => (
                      <tr key={e.eventId}>
                        <td>{date(e.createdAt)}</td>
                        <td>{e.actor}</td>
                        <td>{e.action}</td>
                        <td className="break">{e.target}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.events.length && (
                <p className="muted">
                  No events recorded since this feature was enabled.
                </p>
              )}
              {data.events.length > 0 && data.events.length % 100 === 0 && (
                <button
                  className="button spaced"
                  onClick={async () => {
                    try {
                      const next = await api<Data>(
                        `/admin/operations?before=${data.events.at(-1)!.eventId}`,
                      );
                      setData({
                        ...next,
                        events: [...data.events, ...next.events],
                      });
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Load older events
                </button>
              )}
            </>
          )}
        </div>
      </section>
      {purge && (
        <Modal
          title="Purge withdrawn server content?"
          close={() => setPurge(false)}
          compact
        >
          <div className="modal-body">
            <p>
              This permanently removes eligible withdrawn payloads from this
              registry, including blocked setup copies when they are eligible.
              Revision tombstones and audit events remain. Downloaded copies and
              backups are outside this operation.
            </p>
            <div className="modal-actions">
              <button className="button" onClick={() => setPurge(false)}>
                Cancel
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api("/admin/purge", {
                      confirm: "purge-withdrawn",
                    });
                    setPurge(false);
                    await reload();
                    setMessage(
                      `Purged ${r.purged} eligible payloads. Follow the documented backup-expiry procedure separately.`,
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Purge content
              </button>
            </div>
          </div>
        </Modal>
      )}
      {revoke && (
        <Modal
          title="Revoke member device access?"
          close={() => setRevoke(null)}
          compact
        >
          <div className="modal-body">
            <p>
              {revoke.actorId} / {revoke.label ?? short(revoke.tokenId)} will
              need to renew its login.
            </p>
            <div className="modal-actions">
              <button className="button" onClick={() => setRevoke(null)}>
                Cancel
              </button>
              <button
                className="button danger"
                onClick={async () => {
                  try {
                    await api("/devices/revoke", { tokenId: revoke.tokenId });
                    setRevoke(null);
                    await reload();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Revoke access
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
