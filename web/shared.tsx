import {
  useLayoutEffect,
  useState,
  useRef,
  useId,
  cloneElement,
  isValidElement,
  type ReactNode,
} from "react";
import { Check, Code2, Layers, X } from "lucide-react";
import type { Metrics, Assessment } from "../src/schema";
import type { ProfileListing, SkillListing } from "../src/team-protocol";
import { harnessLabels } from "../src/schema";
import type { WebUser } from "../src/web-auth";
import type { AnalyticsSummary } from "../src/analytics";
import type { Trial } from "../src/operations";

export type Team = { teamName: string; teamId: string; scope: string };
export type Session = {
  user: WebUser | null;
  csrf: string | null;
  setupRequired: boolean;
  team: Team;
};
export type Dashboard = {
  team: Team;
  profiles: ProfileListing[];
  skills: SkillListing[];
  records: Metrics[];
  assessments: Assessment[];
  days: number;
  mode: string;
  truncated: boolean;
  summary: AnalyticsSummary;
  total: number;
  nextOffset: number | null;
  offset: number;
  trials: Trial[];
  comparisons: {
    comparisonId: string;
    runs: number;
    startedAt: string;
    contexts: number;
    sources: number;
    setups: string;
    frozenRuns: number;
  }[];
};
let csrf: string | null = null;
export function setCsrf(value: string | null) {
  csrf = value;
}
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            ...(csrf ? { "X-CSRF-Token": csrf } : {}),
          },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    throw new Error(data.message || "The request failed. Try again.");
  }
  return data as T;
}
export const num = (n: number) =>
  new Intl.NumberFormat("en", {
    notation: n >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(n);
export const money = (n: number | null) =>
  n === null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: n < 1 ? 4 : 2,
      }).format(n);
export const cost = (r: Metrics) =>
  r.models.length &&
  r.models.every((m) => m.estimatedCostUsd !== null && m.usageCalls === m.calls)
    ? r.models.reduce((n, m) => n + (m.estimatedCostUsd ?? 0), 0)
    : null;
export const runHarness = (r: Metrics) => r.harness?.kind ?? "pi";
export const runHarnessLabel = (r: Metrics) => harnessLabels[runHarness(r)];
export const measured = (
  r: Metrics,
  field: keyof NonNullable<Metrics["coverage"]>,
) => r.coverage?.[field] !== "unavailable";
export const measurement = (
  r: Metrics,
  field: keyof NonNullable<Metrics["coverage"]>,
  value: number,
) => (measured(r, field) ? num(value) : "Unavailable");
export const short = (s: string) => s.slice(0, 8);
export const date = (s: string) =>
  new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Layers size={25} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function ErrorBox({ error }: { error: string }) {
  return error ? (
    <div className="error" role="alert">
      {error}
    </div>
  ) : null;
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const control = isValidElement<{ id?: string; "aria-describedby"?: string }>(
    children,
  )
    ? cloneElement(children, {
        id: children.props.id ?? fieldId,
        "aria-describedby":
          [children.props["aria-describedby"], hint ? hintId : null]
            .filter(Boolean)
            .join(" ") || undefined,
      })
    : children;
  return (
    <div className="field">
      <label
        htmlFor={
          isValidElement<{ id?: string }>(children)
            ? (children.props.id ?? fieldId)
            : fieldId
        }
      >
        {label}
      </label>
      {control}
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
  variant = "dialog",
  compact = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  variant?: "dialog" | "drawer" | "navigation";
  compact?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal-backdrop${variant !== "dialog" ? " drawer-backdrop" : ""}${variant === "navigation" ? " nav-dialog-backdrop" : ""}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section className={`modal${compact ? " modal-compact" : ""}`}>
        <div className="panel-heading">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </dialog>
  );
}
export function Copy({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="button secondary"
        onClick={() => {
          navigator.clipboard
            .writeText(text)
            .then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 2200);
            })
            .catch(() => setError("Select and copy the text manually."));
        }}
      >
        {done ? <Check size={15} /> : <Code2 size={15} />}{" "}
        {done ? "Copied" : label}
      </button>
      {error && <small>{error}</small>}
    </>
  );
}
