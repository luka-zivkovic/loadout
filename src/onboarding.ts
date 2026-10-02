export type ComparableSetup = {
  revision: string;
  workflowId: string;
  harness?: { kind: string };
};

export type WorkspaceStep = "connect-device" | "publish-setup";

export function hasComparableSetups(setups: ComparableSetup[]) {
  return setups.some((setup, index) =>
    setups.slice(index + 1).some(
      (candidate) =>
        candidate.revision !== setup.revision &&
        candidate.workflowId === setup.workflowId &&
        (candidate.harness?.kind ?? "pi") ===
          (setup.harness?.kind ?? "pi"),
    ),
  );
}

export function nextWorkspaceStep({
  deviceReady,
  setupCount,
}: {
  deviceReady: boolean;
  setupCount: number;
}): WorkspaceStep | null {
  if (!deviceReady) return "connect-device";
  if (!setupCount) return "publish-setup";
  return null;
}
