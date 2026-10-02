import { observedHarnessSchema } from "./schema.js";

export type ComparableSetup = {
  revision: string;
  workflowId: string;
  harness?: { kind: string };
};

export type WorkspaceStep = "connect-device" | "publish-setup";

export function supportsSetupComparison(harness: string): boolean {
  return observedHarnessSchema.safeParse(harness).success;
}

export function hasComparableSetups(setups: ComparableSetup[]) {
  const eligible = setups.filter((setup) =>
    supportsSetupComparison(setup.harness?.kind ?? "pi"),
  );
  return eligible.some((setup, index) =>
    eligible.slice(index + 1).some(
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
