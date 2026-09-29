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
function localUrl(value: string) {
  try {
    return new URL(value, location.href);
  } catch {
    throw new Error("Use a valid workspace URL.");
  }
}
export function go(
  value: string,
  replace = false,
  state: { returnTo?: string } | null = null,
) {
  const url = localUrl(value);
  if (url.origin !== location.origin) throw new Error("Use a workspace URL.");
  history[replace ? "replaceState" : "pushState"](
    state,
    "",
    url.pathname + url.search,
  );
  dispatchEvent(new Event("loadout:navigate"));
}
export function setParam(key: string, value: string | null, replace = false) {
  const url = localUrl(location.href);
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
export type ArtifactRef = {
  owner: string;
  name: string;
  revision: string;
};
export const artifactUrl = (kind: "profile" | "skill", ref: ArtifactRef) =>
  `${kind === "profile" ? "/setups?setup=" : "/skills?skill="}${encodeURIComponent(`${ref.owner}/${ref.name}/${ref.revision}`)}`;
export const setupPageUrl = (ref: ArtifactRef) =>
  `/setups/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/${ref.revision}`;
export function setupPageRef(pathname: string): ArtifactRef | null {
  const match =
    /^\/setups\/([^/]+)\/([^/]+)\/([a-f0-9]{64})$/.exec(pathname);
  const owner = match?.[1];
  const name = match?.[2];
  const revision = match?.[3];
  if (!owner || !name || !revision) return null;
  try {
    return {
      owner: decodeURIComponent(owner),
      name: decodeURIComponent(name),
      revision,
    };
  } catch {
    return null;
  }
}
