import { OverviewNext } from "./OverviewNext";
import { go, setupPageRef, useLocation, useParam } from "./navigation";
import { useEffect, useState, useRef, type FormEvent } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Code2,
  Cpu,
  GitCompareArrows,
  Layers,
  LogOut,
  Monitor,
  Menu,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Lightbulb,
  Users,
} from "lucide-react";
import {
  api,
  setCsrf,
  num,
  money,
  cost,
  measured,
  runHarness,
  date,
  short,
  Empty,
  ErrorBox,
  Field,
  Modal,
  type Session,
  type Dashboard,
} from "./shared";
import { flushSync } from "react-dom";
import { registerDashboardTools } from "./agent-tools";
import { SharingLink } from "./Sharing";
import { Setups, SetupPage, Skills } from "./Library";
import loadoutMark from "./assets/loadout.svg";
import { harnessLabels, observedHarnessSchema } from "../src/schema";
import { ActivityView, Comparisons, Devices, TeamAccess } from "./Views";
import { People } from "./People";
import { Requests } from "./Requests";
import { hasComparableSetups } from "../src/onboarding";

const routes = [
  { path: "/", label: "Overview", icon: BarChart3 },
  { path: "/setups", label: "Shared setups", icon: Layers },
  { path: "/skills", label: "Shared skills", icon: Sparkles },
  { path: "/requests", label: "Skill requests", icon: Lightbulb },
  { path: "/people", label: "People", icon: Users },
  { path: "/activity", label: "Activity", icon: Activity },
  { path: "/comparisons", label: "Comparisons", icon: GitCompareArrows },
  { path: "/devices", label: "My devices", icon: Monitor },
  { path: "/team", label: "Team & access", icon: Users },
];
const navigationGroups = [
  { label: "", paths: ["/"] },
  { label: "Library", paths: ["/setups", "/skills", "/requests"] },
  { label: "Evidence", paths: ["/activity", "/comparisons"] },
  { label: "Workspace", paths: ["/people", "/devices", "/team"] },
];
function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <img
          src={loadoutMark}
          width={36}
          height={36}
          alt=""
          aria-hidden="true"
        />
      </span>
      <span className="brand-wordmark">
        loadout<span className="brand-dot">_</span>
        <small>Harness collective</small>
      </span>
    </div>
  );
}

function Navigation({
  path,
  comparisonAvailable,
  navigate,
}: {
  path: string;
  comparisonAvailable: boolean;
  navigate: (path: string) => void;
}) {
  return (
    <nav aria-label="Workspace navigation">
      {navigationGroups.map((group) => {
        const items = routes.filter(
          (route) =>
            group.paths.includes(route.path) &&
            (route.path !== "/comparisons" ||
              comparisonAvailable ||
              route.path === path),
        );
        if (!items.length) return null;
        return (
          <div className="nav-group" key={group.label || "overview"}>
            {group.label && <span>{group.label}</span>}
            {items.map((route) => (
              <a
                key={route.path}
                href={route.path}
                title={route.label}
                aria-current={route.path === path ? "page" : undefined}
                className={
                  route.path === path ? "nav-item active" : "nav-item"
                }
                onClick={(event) => {
                  event.preventDefault();
                  navigate(route.path);
                }}
              >
                <route.icon size={17} aria-hidden="true" />
                <span>{route.label}</span>
              </a>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

function Auth({
  session,
  onAuth,
  path,
  token,
}: {
  session: Session;
  onAuth: () => void;
  path: string;
  token: string;
}) {
  const kind =
    path === "/join"
      ? "join"
      : path === "/reset"
        ? "reset"
        : session.setupRequired
          ? "setup"
          : "login";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ email: string | null; role: string; expiresAt: string; multiUse: boolean } | null>(
    null,
  );
  const [joinHandle, setJoinHandle] = useState("");
  const [customJoinHandle, setCustomJoinHandle] = useState(false);
  const unavailable =
    (kind === "join" || kind === "reset") && Boolean(error) && !info;
  useEffect(() => {
    if (kind === "join" || kind === "reset") {
      setInfo(null);
      setError("");
      api("/auth/challenge", {
        token,
        kind: kind === "join" ? "invite" : "reset",
      })
        .then(setInfo)
        .catch((e) => setError(e.message));
    }
  }, [kind, token]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api(`/auth/${kind}`, {
        ...values,
        ...(kind === "join" || kind === "reset" ? { token } : {}),
      });
      onAuth();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <Brand />
        <div>
          <h1>
            Your team’s
            <br />
            better defaults.
          </h1>
          <p>
            Discover the setups behind good work.
            <br />
            Try them on your own code. Learn together.
          </p>
          <div className="story-lines">
            <div>
              <Layers size={20} />
              <span>Portable harness configurations</span>
            </div>
            <div>
              <BarChart3 size={20} />
              <span>Workflow, tool, and spend analytics</span>
            </div>
            <div>
              <GitCompareArrows size={20} />
              <span>Comparisons with context in view</span>
            </div>
          </div>
        </div>
        <span className="story-footer">
          <ShieldCheck size={16} /> Conversations stay on your devices.
        </span>
      </aside>
      <main className="auth-main">
        <span className="team-label">
          <span className="status-dot" />
          {session.team.teamName} / {session.team.scope}
        </span>
        <div className="auth-form">
          <h1>
            {unavailable
              ? "This link is unavailable"
              : kind === "setup"
                ? "Create your admin account"
                : kind === "join"
                  ? "Join your team"
                  : kind === "reset"
                    ? "Choose a new password"
                    : "Sign in to Loadout"}
          </h1>
          <p className="muted">
            {unavailable
              ? "Ask a teammate for a new link, or return to your workspace if you already have access."
              : kind === "setup"
                ? "Start your workspace, then invite your teammates."
                : kind === "join"
                  ? info?.multiUse
                    ? `This link lets teammates join as members until ${date(info.expiresAt)}. Use your own email and choose a password.`
                    : `Your invitation is for ${info?.email ?? "…"}. You choose your own password.`
                  : kind === "reset"
                    ? `Set a new password for ${info?.email ?? "your account"}. This also disconnects your devices.`
                    : "Your shared setups and team activity, in one place."}
          </p>
          {unavailable ? (
            <ErrorBox error={error} />
          ) : (
            <form onSubmit={submit}>
              {kind === "setup" && (
                <Field
                  label="Installation key"
                  hint="Open the private setup link saved by the server, or paste its key here."
                >
                  <input
                    name="token"
                    required
                    defaultValue={token}
                    autoComplete="off"
                    placeholder="psb_…"
                  />
                </Field>
              )}
              {(kind === "setup" || kind === "join") && (
                <Field label="Full name">
                  <input
                    name="name"
                    required
                    maxLength={100}
                    autoComplete="name"
                    placeholder="Your name"
                  />
                </Field>
              )}
              {(kind === "setup" || kind === "login" || (kind === "join" && info?.multiUse)) && (
                <Field label="Email address">
                  <input
                    name="email"
                    type="email"
                    onChange={kind === "join" ? (e) => {
                      if (!customJoinHandle)
                        setJoinHandle(e.target.value.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "").replace(/^[^a-z0-9]+/, "").slice(0, 80));
                    } : undefined}
                    required
                    maxLength={254}
                    autoComplete="username"
                    placeholder="you@company.com"
                  />
                </Field>
              )}
              {(kind === "setup" || (kind === "join" && info?.multiUse)) && (
                <Field
                  label="Member handle"
                  hint="Used to identify your setups and activity across devices."
                >
                  <input
                    name="actorId"
                    value={kind === "join" ? joinHandle : undefined}
                    onChange={kind === "join" ? (e) => { setCustomJoinHandle(true); setJoinHandle(e.target.value); } : undefined}
                    required
                    pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{0,79}"
                    placeholder="e.g. alex"
                  />
                </Field>
              )}
              <Field
                label="Password"
                hint={
                  kind === "login" ? undefined : "Use at least 12 characters."
                }
              >
                <input
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={256}
                  autoComplete={
                    kind === "login" ? "current-password" : "new-password"
                  }
                />
              </Field>
              <ErrorBox error={error} />
              <button
                className="button primary full"
                disabled={
                  busy || ((kind === "join" || kind === "reset") && !info)
                }
              >
                {busy
                  ? "Please wait…"
                  : kind === "setup"
                    ? "Create workspace"
                    : kind === "join"
                      ? "Create my account"
                      : kind === "reset"
                        ? "Reset password"
                        : "Sign in"}
                <ArrowRight size={17} />
              </button>
            </form>
          )}
          {(kind === "join" || kind === "reset") && (
            <a className="text-button spaced" href="/">
              {session.user ? "Back to workspace" : "Back to sign in"}
            </a>
          )}
          <p className="auth-foot">
            {kind === "login"
              ? "New here? Ask a teammate for a join link. For password resets, contact an admin."
              : "Account access is managed by your team."}
          </p>
          <SharingLink />
        </div>
        <span className="auth-bottom">
          Self-hosted · Invitation only · Pi, Claude Code, Codex, Cursor & OpenCode
        </span>
      </main>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const locationKey = useLocation();
  const path = locationKey.split("?")[0];
  const setupPage = setupPageRef(path);
  const [token] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("token") ?? "",
  );
  const requestSeq = useRef(0);
  const [data, setData] = useState<Dashboard | null>(null);
  const [days, setDays] = useParam("days", "30");
  const [mode, setMode] = useParam("mode", "live");
  const [harness, setHarness] = useParam("harness");
  const [loading, setLoading] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigate = (value: string) => {
    go(value);
    setNavigationOpen(false);
    window.scrollTo(0, 0);
  };
  const loadSession = () =>
    api<Session>("/session")
      .then((s) => {
        setCsrf(s.csrf);
        setSession(s);
        setError("");
      })
      .catch((e) => setError(e.message));
  const refresh = () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");
    return api<Dashboard>(
      `/dashboard?days=${days}&mode=${mode}${harness ? `&harness=${harness}` : ""}`,
    )
      .then((d) => {
        if (seq === requestSeq.current) setData(d);
      })
      .catch((e) => {
        if (seq === requestSeq.current) setError(e.message);
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  };
  useEffect(() => {
    if (location.hash)
      history.replaceState(null, "", location.pathname + location.search);
    void loadSession();
    const expired = () => {
      setCsrf(null);
      setData(null);
      void loadSession();
    };
    window.addEventListener("session-expired", expired);
    return () => {
      window.removeEventListener("session-expired", expired);
    };
  }, []);
  useEffect(() => {
    if (session?.user) void refresh();
  }, [session?.user?.userId, days, mode, harness]);
  useEffect(() => {
    if (!session?.user) return;
    return registerDashboardTools({
      navigate: (value) => flushSync(() => navigate(value)),
      summary: () =>
        data
          ? {
              team: data.team.teamName,
              scope: data.team.scope,
              days: data.days,
              mode: data.mode,
              runs: data.summary.runs,
              setups: data.profiles.length,
              knownEstimatedCostUsd: data.summary.spend,
              runsMissingCompletePricing:
                data.summary.runs - data.summary.pricedRuns,
              truncated: data.truncated,
            }
          : { loading: true },
    });
  }, [session?.user?.userId, data]);
  if (!session)
    return (
      <div className="loading-page">
        <Brand />
        {error ? (
          <>
            <ErrorBox error={error} />
            <button className="button" onClick={loadSession}>
              Retry
            </button>
          </>
        ) : (
          <p>Connecting to your workspace…</p>
        )}
      </div>
    );
  if (!session.user || path === "/join" || path === "/reset")
    return (
      <Auth
        key={path + session.setupRequired}
        session={session}
        path={path}
        token={token}
        onAuth={() => {
          if (["/login", "/setup", "/join", "/reset"].includes(path))
            navigate("/");
          void loadSession();
        }}
      />
    );
  const user = session.user;
  const comparisonAvailable = Boolean(
    data?.trials.length || hasComparableSetups(data?.profiles ?? []),
  );
  const activePath = setupPage ? "/setups" : path;
  const active = routes.find((route) => route.path === activePath) ?? routes[0];
  const logout = () =>
    api("/auth/logout", {})
      .then(() => {
        setData(null);
        setNavigationOpen(false);
        return loadSession();
      })
      .catch((e) => setError(e.message));
  return (
    <div
      className={`workspace${mode === "demo" ? " demo-view" : ""}`}
      data-view={active.path}
    >
      <a className="skip-link" href="#workspace-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="workspace-name">
          <span className="workspace-letter">
            {session.team.teamName[0].toUpperCase()}
          </span>
          <div>
            <strong>{session.team.teamName}</strong>
            <small>{session.team.scope} workspace</small>
          </div>
        </div>
        <Navigation
          path={active.path}
          comparisonAvailable={comparisonAvailable}
          navigate={navigate}
        />
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={18} />
            <div>
              <strong>Shared configuration.</strong>
              <small>Private conversations.</small>
            </div>
          </div>
          <div className="account">
            <button
              type="button"
              className="account-profile"
              onClick={() => navigate("/people")}
              aria-label="Open your profile and team directory"
            >
              <span className="avatar">
                {user.name.slice(0, 2).toUpperCase()}
              </span>
              <span>
                <strong>{user.name}</strong>
                <small>{user.role}</small>
              </span>
            </button>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={logout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <button
            className="icon-button menu-toggle"
            aria-label="Open navigation"
            aria-expanded={navigationOpen}
            aria-haspopup="dialog"
            onClick={() => setNavigationOpen(true)}
          >
            <Menu size={20} />
          </button>
          <span className="breadcrumb">
            {session.team.teamName}
            <span className="slash">/</span>
            <strong>{active.label}</strong>
          </span>
          <span className="local-label">
            <span className="status-dot" />
            Self-hosted workspace
          </span>
        </header>
        <main className="content" id="workspace-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <h1>
                {setupPage
                  ? `${setupPage.owner} / ${setupPage.name}`
                  : active.path === "/"
                    ? "Overview"
                    : active.label}
              </h1>
              <p className="muted">
                {setupPage
                  ? `Pinned setup revision ${short(setupPage.revision)}. Inspect its contents before running it locally.`
                  : active.path === "/"
                    ? "How your team’s harnesses run. Discover the setups behind the work."
                    : active.path === "/setups"
                      ? "Your team’s configurations. Versioned, inspectable, ready to run."
                    : active.path === "/skills"
                      ? "Borrow a useful skill. Keep the setup that works for you."
                      : active.path === "/requests"
                        ? "Suggest a skill, discuss the idea, and see who would use it."
                      : active.path === "/people"
                        ? "Find teammates by name, job title, or company team."
                        : active.path === "/activity"
                          ? "What ran, which tools it used, and what it cost."
                          : active.path === "/comparisons"
                          ? "Try a teammate’s setup locally, compare the evidence, and record what to keep."
                          : active.path === "/devices"
                            ? "Connect your harnesses without sharing account passwords."
                            : active.path === "/team" && user.role === "member"
                              ? "Invite teammates with links you can revoke any time."
                              : "Invite teammates and manage who can access this workspace."}
              </p>
            </div>
            {!setupPage && ["/setups", "/skills"].includes(active.path) && data ? (
              <div className="heading-readout">
                <div>
                  <strong>
                    {String(
                      active.path === "/setups"
                        ? data.profiles.length
                        : data.skills.length,
                    ).padStart(2, "0")}
                  </strong>
                  <span>
                    {active.path === "/setups"
                      ? "shared setups"
                      : "shared skills"}
                  </span>
                </div>
                <div>
                  <strong>
                    {String(
                      new Set(
                        active.path === "/setups"
                          ? data.profiles.map((p) => p.harness?.kind ?? "pi")
                          : data.skills.flatMap((s) => s.compatibleWith),
                      ).size,
                    ).padStart(2, "0")}
                  </strong>
                  <span>harnesses</span>
                </div>
              </div>
            ) : null}
          </div>
          <ErrorBox error={error} />
          {!["/people", "/devices", "/team", "/setups", "/requests"].includes(active.path) && (
            <div className="toolbar">
              {mode === "demo" && (
                <div className="demo-source">
                  <span>Viewing isolated demo activity</span>
                  <button
                    className="text-button"
                    onClick={() => {
                      setData(null);
                      setMode("live");
                    }}
                  >
                    Return to live data
                  </button>
                </div>
              )}
              <div className="toolbar-right">
                {!["/setups", "/skills"].includes(active.path) && (
                  <select
                    aria-label="Activity harness"
                    value={harness}
                    onChange={(e) => {
                      setData(null);
                      setHarness(e.target.value);
                    }}
                  >
                    <option value="">All harnesses</option>
                    {harness && !observedHarnessSchema.options.includes(harness as (typeof observedHarnessSchema.options)[number]) && (
                      <option value={harness}>Unavailable harness: {harness}</option>
                    )}
                    {observedHarnessSchema.options.map((key) => (
                      <option key={key} value={key}>
                        {harnessLabels[key]}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  aria-label="Time period"
                  value={days}
                  onChange={(e) => {
                    setData(null);
                    setDays(e.target.value);
                  }}
                >
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                </select>
                <button
                  className="icon-button"
                  onClick={refresh}
                  disabled={loading}
                  aria-label="Refresh data"
                >
                  <RefreshCw size={17} className={loading ? "spin" : ""} />
                </button>
              </div>
            </div>
          )}
          {mode === "demo" &&
            !["/people", "/devices", "/team", "/requests"].includes(active.path) && (
            <div className="notice">
              Demo measurements are isolated from live activity. They do not
              indicate real model quality or spend.
            </div>
          )}
          {active.path === "/" ? (
            data ? (
              <Overview data={data} navigate={navigate} />
            ) : (
              <div className="panel loading">
                {loading
                  ? "Loading team activity…"
                  : "Activity unavailable. Try refreshing."}
              </div>
            )
          ) : active.path === "/people" ? (
            <People user={user} />
          ) : active.path === "/requests" ? (
            <Requests user={user} />
          ) : active.path === "/devices" ? (
            <Devices team={session.team} />
          ) : active.path === "/team" ? (
            <TeamAccess user={user} />
          ) : data ? (
            active.path === "/setups" ? (
              setupPage ? (
                <SetupPage
                  key={`${setupPage.owner}/${setupPage.name}/${setupPage.revision}`}
                  reference={setupPage}
                  data={data}
                  refresh={refresh}
                  user={user}
                />
              ) : (
                <Setups data={data} refresh={refresh} user={user} />
              )
            ) : active.path === "/skills" ? (
              <Skills data={data} refresh={refresh} user={user} />
            ) : active.path === "/activity" ? (
              <ActivityView
                data={data}
                user={user}
                refresh={refresh}
                harness={harness}
              />
            ) : (
              <Comparisons data={data} user={user} refresh={refresh} />
            )
          ) : (
            <div className="panel loading">
              {loading
                ? "Loading team activity…"
                : "Activity unavailable. Try refreshing."}
            </div>
          )}
          <footer className="content-footer">
            <span>
              loadout <span className="muted">/</span> {session.team.scope}
            </span>
            <SharingLink />
            <span>
              Usage estimates from provider metadata. Quality requires human
              review.
            </span>
          </footer>
        </main>
      </div>
      {navigationOpen && (
        <Modal
          title={session.team.teamName}
          variant="navigation"
          close={() => setNavigationOpen(false)}
        >
          <div className="modal-body mobile-navigation">
            <p className="muted">{session.team.scope} workspace</p>
            <div className="spaced">
              <Navigation
                path={active.path}
                comparisonAvailable={comparisonAvailable}
                navigate={navigate}
              />
            </div>
            <div className="account spaced">
              <button
                type="button"
                className="account-profile"
                onClick={() => navigate("/people")}
                aria-label="Open your profile and team directory"
              >
                <span className="avatar">
                  {user.name.slice(0, 2).toUpperCase()}
                </span>
                <span>
                  <strong>{user.name}</strong>
                  <small>{user.role}</small>
                </span>
              </button>
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={logout}
              >
                <LogOut size={17} />
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Overview({
  data,
  navigate,
}: {
  data: Dashboard;
  navigate: (s: string) => void;
}) {
  const totals = data.summary;
  if (!data.liveRunCount)
    return <OverviewNext data={data} navigate={navigate} />;
  const totalCost = totals.spend;
  const missing = totals.runs - totals.pricedRuns;
  const toolCalls = totals.toolCalls;
  const tools = totals.tools
    .slice(0, 5)
    .map(
      (t) =>
        [
          `${harnessLabels[t.harness as keyof typeof harnessLabels]} / ${t.name}`,
          t.calls,
        ] as const,
    );
  const dayKeys = Array.from({ length: data.days }, (_, i) =>
    new Date(Date.now() - (data.days - 1 - i) * 86400000)
      .toISOString()
      .slice(0, 10),
  );
  const daily = dayKeys.map(
    (d) => totals.daily.find((row) => row.day === d)?.runs ?? 0,
  );
  const max = Math.max(1, ...daily);
  const memberCount = totals.members;
  const missingTools = totals.missingTools;
  const missingSkills = totals.missingSkills;
  return (
    <>
      <OverviewNext data={data} navigate={navigate} showSetups={false} />
      <div className="metric-grid">
        {[
          {
            label: "Runs shared",
            value: num(totals.runs),
            note: `Across ${memberCount} active ${memberCount === 1 ? "member" : "members"}`,
            icon: Activity,
          },
          {
            label: "Estimated spend",
            value:
              totals.runs && missing === totals.runs
                ? "Unavailable"
                : money(totalCost),
            note: missing
              ? `${missing} ${missing === 1 ? "run" : "runs"} excluded: incomplete pricing`
              : "USD · provider usage estimates",
            icon: BarChart3,
          },
          {
            label: "Tool calls",
            value:
              totals.runs && missingTools === totals.runs
                ? "Unavailable"
                : num(toolCalls),
            note:
              missingTools || missingSkills
                ? `${missingTools} runs lack tool data · ${missingSkills} lack skill data`
                : "Tool and skill coverage available",
            icon: Cpu,
          },
          {
            label: "Shared setups",
            value: num(data.profiles.length),
            note: `${data.skills?.length ?? 0} standalone shared ${data.skills?.length === 1 ? "skill" : "skills"}`,
            icon: Layers,
          },
        ].map((m) => (
          <section className="metric" key={m.label}>
            <div>
              <span>{m.label}</span>
              <m.icon size={17} />
            </div>
            <strong>{m.value}</strong>
            <small>{m.note}</small>
          </section>
        ))}
      </div>
      <div className="chart-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Workflow activity</h2>
              <p>Shared runs per day · UTC</p>
            </div>
            <span className="legend">
              <i />
              Runs
            </span>
          </div>
          {totals.runs ? (
            <div className="chart">
              <div
                className="chart-bars"
                role="img"
                aria-label={`${totals.runs} ${totals.runs === 1 ? "run" : "runs"} over ${data.days} days`}
              >
                {daily.map((n, i) => (
                  <div
                    key={dayKeys[i]}
                    className="bar-column"
                    title={`${dayKeys[i]}: ${n} runs`}
                    tabIndex={n ? 0 : undefined}
                    aria-label={`${dayKeys[i]}: ${n} runs`}
                  >
                    <span
                      style={{
                        height: `${Math.max(n ? 3 : 0, (n / max) * 100)}%`,
                      }}
                    />
                    <b className="chart-tooltip" aria-hidden="true">
                      {dayKeys[i]} · {n} runs
                    </b>
                  </div>
                ))}
              </div>
              <div className="axis">
                <span>{dayKeys[0]}</span>
                <span>{dayKeys.at(-1)}</span>
              </div>
            </div>
          ) : (
            <Empty
              title="Usage collection is optional"
              action={
                <button
                  className="button secondary"
                  onClick={() => navigate("/devices?measure=1")}
                >
                  Set up measurement
                  <ArrowRight size={15} />
                </button>
              }
            >
              Share a setup without measuring activity. When you want usage
              data, collect one workflow and sync its finalized metadata.
            </Empty>
          )}
          <details className="daily-values">
            <summary>View daily values</summary>
            <table>
              <thead>
                <tr>
                  <th>Date (UTC)</th>
                  <th>Runs</th>
                </tr>
              </thead>
              <tbody>
                {dayKeys.map((day, i) => (
                  <tr key={day}>
                    <td>{day}</td>
                    <td>{daily[i]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Tool usage</h2>
              <p>Most-used tools in shared runs</p>
            </div>
            <Code2 size={18} />
          </div>
          {tools.length ? (
            <div className="tool-list">
              {tools.map(([name, n]) => (
                <div className="tool-row" key={name}>
                  <div>
                    <code>{name}</code>
                    <strong>{num(n)}</strong>
                  </div>
                  <div className="meter">
                    <i style={{ width: `${(n / tools[0][1]) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="quiet-empty">
              <Cpu size={28} />
              <p>Tool usage appears after your first sync.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
