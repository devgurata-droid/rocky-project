import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldShowPendingAuthCard,
  shouldShowUpdateStatusCard,
} from "../../web/src/domains/codex/lib/account-status-visibility.js";

test("shouldShowPendingAuthCard only shows browser auth details while pending", () => {
  assert.equal(
    shouldShowPendingAuthCard({
      status: "pending",
      verificationUri: "https://auth.example.test",
      code: null,
      instructions: null,
      lineCount: 0,
    }),
    true
  );

  assert.equal(
    shouldShowPendingAuthCard({
      status: "completed",
      verificationUri: "https://auth.example.test",
      code: "ABCD-EFGH",
      instructions: "Login successful.",
      lineCount: 3,
    }),
    false
  );
});

test("shouldShowUpdateStatusCard hides completed update cards once the CLI is current", () => {
  assert.equal(
    shouldShowUpdateStatusCard({
      updateStatus: "completed",
      updateSupported: true,
      latestStatus: "current",
    }),
    false
  );

  assert.equal(
    shouldShowUpdateStatusCard({
      updateStatus: "failed",
      updateSupported: true,
      latestStatus: "current",
    }),
    true
  );

  assert.equal(
    shouldShowUpdateStatusCard({
      updateStatus: "idle",
      updateSupported: true,
      latestStatus: "update-available",
    }),
    true
  );
});
