import { useEffect, useState } from "react";
import { api, date, short, type Dashboard } from "./shared";
import { artifactUrl } from "./navigation";
import { HarnessLabel } from "./HarnessIcon";
export function OverviewNext({
  data,
  navigate,
}: {
  data: Dashboard;
  navigate: (path: string) => void;
}) {
  const [devices, setDevices] = useState<
    | { revokedAt: string | null; expiresAt: string; syncedAt: string | null }[]
    | null
  >(null);
  useEffect(() => {
    let live = true;
    api("/devices")
      .then((r) => {
        if (live) setDevices(r.devices);
      })
      .catch(() => {
        if (live) setDevices(null);
      });
    return () => {
      live = false;
    };
  }, [data]);
  const active = devices?.filter(
    (d) => !d.revokedAt && Date.parse(d.expiresAt) > Date.now(),
  );
  const lastSync = active
    ?.flatMap((d) => (d.syncedAt ? [d.syncedAt] : []))
    .sort()
    .at(-1);
  const pending = data.trials.filter((t) => !t.conclusion).slice(0, 3);
  return (
    <div className="overview-next">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Latest shared revisions</h2>
            <p>Inspect what changed before trying it locally.</p>
          </div>
          <button className="text-button" onClick={() => navigate("/setups")}>
            Browse library
          </button>
        </div>
        <div className="revision-feed">
          {data.profiles.slice(0, 3).map((p) => (
            <button
              key={p.owner + p.revision}
              onClick={() => navigate(artifactUrl("profile", p))}
            >
              <HarnessLabel harness={p.harness?.kind ?? "pi"} />
              <strong>{p.name}</strong>
              <span>
                {p.owner} · {short(p.revision)} · {date(p.publishedAt)}
              </span>
            </button>
          ))}
          {!data.profiles.length && (
            <p>Publish a reusable setup to start the team library.</p>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Continue your work</h2>
        </div>
        <div className="panel-body next-actions">
          <div>
            <strong>
              {active
                ? `${active.length} authorized ${active.length === 1 ? "device" : "devices"}`
                : "Device status"}
            </strong>
            <p className="muted">
              {lastSync
                ? `Latest reported sync ${date(lastSync)}`
                : "No successful sync reported yet."}
            </p>
            <button
              className="text-button"
              onClick={() => navigate("/devices")}
            >
              Review devices and sync
            </button>
          </div>
          {pending.map((t) => (
            <div key={t.trialId}>
              <button
                className="text-button"
                onClick={() => navigate(`/comparisons?trial=${t.trialId}`)}
              >
                {t.name}
              </button>
              <p className="muted">Awaiting evaluation · {t.owner}</p>
            </div>
          ))}
          {!pending.length && (
            <div>
              <p className="muted">
                Compare one colleague’s revision with your own setup.
              </p>
              <button
                className="button primary"
                onClick={() => navigate("/comparisons?new=1")}
              >
                Start a setup trial
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
