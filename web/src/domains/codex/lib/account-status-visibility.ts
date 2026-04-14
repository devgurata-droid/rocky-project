export type PendingAuthStatus = "idle" | "pending" | "completed" | "failed";
export type UpdateStatus = "idle" | "pending" | "completed" | "failed";
export type LatestStatus = "current" | "update-available" | "unknown" | "error";

export function shouldShowPendingAuthCard(input: {
  status: PendingAuthStatus;
  verificationUri: string | null;
  code: string | null;
  instructions: string | null;
  lineCount: number;
}): boolean {
  if (input.status !== "pending") {
    return false;
  }

  return Boolean(
    input.verificationUri ||
      input.code ||
      input.instructions ||
      input.lineCount > 0
  );
}

export function shouldShowUpdateStatusCard(input: {
  updateStatus: UpdateStatus;
  updateSupported: boolean;
  latestStatus: LatestStatus;
}): boolean {
  if (input.updateStatus === "pending" || input.updateStatus === "failed") {
    return true;
  }

  return input.updateSupported && input.latestStatus === "update-available";
}
