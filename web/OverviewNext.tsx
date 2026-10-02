import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import {
  nextWorkspaceStep,
  type WorkspaceStep,
} from "../src/onboarding";
import { api, date, short, type Dashboard } from "./shared";
import { artifactUrl } from "./navigation";
import { HarnessLabel } from "./HarnessIcon";

const stepCopy: Record<
  WorkspaceStep,
  { title: string; description: string; action: string }
> = {
  "connect-device": {
    title: "Connect your first device",
    description:
      "Authorize one local harness. Connecting does not publish configurations or upload existing activity.",
    action: "Connect a device",
  },
  "publish-setup": {
    title: "Share your first setup",
    description:
      "Capture a reusable configuration, inspect its contents, then publish that exact revision.",
    action: "Share a setup",
  },
};

export function OverviewNext({
  data,
  navigate,
  showSetups = true,
}: {
  data: Dashboard;
  navigate: (path: string) => void;
  showSetups?: boolean;
}) {
  const [devices, setDevices] = useState<
    | { revokedAt: string | null; expiresAt: string; syncedAt: string | null }[]
    | null
  >(null);
  useEffect(() => {
    let live = true;
    api("/devices")
      .then((response) => {
        if (live) setDevices(response.devices);
      })
      .catch(() => {
        if (live) setDevices([]);
      });
    return () => {
      live = false;
    };
  }, [data]);
  const active = devices?.filter(
    (device) =>
      !device.revokedAt && Date.parse(device.expiresAt) > Date.now(),
  );
  const lastSync = active
    ?.flatMap((device) => (device.syncedAt ? [device.syncedAt] : []))
    .sort()
    .at(-1);
  const step =
    devices === null
      ? null
      : nextWorkspaceStep({
          deviceReady: Boolean(active?.length),
          setupCount: data.profiles.length,
        });
  const nextPath = step
    ? step === "connect-device"
      ? "/devices?connect=1"
      : "/setups?share=1"
    : "";
  const readiness = [
    { label: "Device connected", done: Boolean(active?.length) },
    { label: "Setup shared", done: Boolean(data.profiles.length) },
  ];
  return (
    <div className={`overview-next${showSetups ? "" : " compact"}`}>
      <section className="panel onboarding-panel">
        <div className="panel-heading">
          <div>
            <h2>
              {data.profiles.length ? "Your setup is shared" : "Share your setup once"}
            </h2>
            <p>Connect a device and publish one reviewed snapshot. Usage collection is optional.</p>
          </div>
        </div>
        <div className="onboarding-body">
          <ol className="readiness-list">
            {readiness.map((item) => (
              <li className={item.done ? "complete" : ""} key={item.label}>
                <span aria-hidden="true">
                  {item.done ? <Check size={14} /> : null}
                </span>
                {item.label}
              </li>
            ))}
          </ol>
          <div className="next-action">
            {step ? (
              <>
                <strong>{stepCopy[step].title}</strong>
                <p>{stepCopy[step].description}</p>
                <button
                  className="button primary"
                  onClick={() => navigate(nextPath)}
                >
                  {stepCopy[step].action}
                </button>
              </>
            ) : devices === null ? (
              <p>Checking workspace readiness…</p>
            ) : (
              <>
                <strong>Ready to use</strong>
                <p>Your published setup stays available without ongoing collection. Capture and publish again only when you want to share a change.</p>
                <button className="button secondary" onClick={() => navigate("/setups")}>Browse shared setups</button>
              </>
            )}
            {lastSync && (
              <small>Last successful device sync {date(lastSync)}</small>
            )}
          </div>
        </div>
      </section>
      {showSetups && (
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
            {data.profiles.slice(0, 3).map((profile) => (
              <button
                key={profile.owner + profile.revision}
                onClick={() => navigate(artifactUrl("profile", profile))}
              >
                <HarnessLabel harness={profile.harness?.kind ?? "pi"} />
                <strong>{profile.name}</strong>
                <span>
                  {profile.owner} · {short(profile.revision)} ·{" "}
                  {date(profile.publishedAt)}
                </span>
              </button>
            ))}
            {!data.profiles.length && (
              <p>Published setup revisions will appear here.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
