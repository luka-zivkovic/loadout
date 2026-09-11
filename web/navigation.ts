import { useSyncExternalStore } from "react";
const snapshot = () => location.pathname + location.search;
const subscribe = (listener: () => void) => {
  addEventListener("popstate", listener);
  addEventListener("loadout:navigate", listener);
  return () => {
    removeEventListener("popstate", listener);
    removeEventListener("loadout:navigate", listener);
  };
};
export const useLocation = () => useSyncExternalStore(subscribe, snapshot);
export function go(value: string, replace = false) {
  const url = new URL(value, location.href);
  if (url.origin !== location.origin) throw new Error("Use a workspace URL.");
  history[replace ? "replaceState" : "pushState"](
    null,
    "",
    url.pathname + url.search,
  );
  dispatchEvent(new Event("loadout:navigate"));
}
export function setParam(key: string, value: string | null, replace = false) {
  const url = new URL(location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  go(url.pathname + url.search, replace);
}
export function useParam(
  key: string,
  fallback = "",
): [string, (value: string | null) => void] {
  const url = useLocation();
  return [
    new URL(url, location.origin).searchParams.get(key) ?? fallback,
    (value) => setParam(key, value),
  ];
}
export const artifactUrl = (
  kind: "profile" | "skill",
  ref: { owner: string; name: string; revision: string },
) =>
  `${kind === "profile" ? "/setups?setup=" : "/skills?skill="}${encodeURIComponent(`${ref.owner}/${ref.name}/${ref.revision}`)}`;
