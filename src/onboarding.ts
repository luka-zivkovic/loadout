export type ComparableSetup = {
  revision: string;
  workflowId: string;
  harness?: { kind: string };
};

export type WorkspaceStep =
  | "connect-device"
  | "publish-setup"
  | "continue-trial"
  | "measure-run"
  | "publish-comparable"
  | "start-trial";

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
  runCount,
  comparable,
  pendingTrialCount,
}: {
  deviceReady: boolean;
  setupCount: number;
  runCount: number;
  comparable: boolean;
  pendingTrialCount: number;
}): WorkspaceStep {
  if (!deviceReady) return "connect-device";
  if (!setupCount) return "publish-setup";
  if (pendingTrialCount) return "continue-trial";
  if (!runCount) return "measure-run";
  if (!comparable) return "publish-comparable";
  return "start-trial";
}
