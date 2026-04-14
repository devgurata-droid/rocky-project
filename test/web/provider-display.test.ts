import test from "node:test";
import assert from "node:assert/strict";

import {
  formatUsageWindowSummary,
  providerAccountLabel,
} from "../../web/src/domains/codex/lib/provider-display.js";

test("providerAccountLabel prefers email over opaque provider ids", () => {
  assert.equal(
    providerAccountLabel({
      label: null,
      email: "dev.gurata@gmail.com",
      name: "Dev Gurata",
      userId: "google-oauth2|115156844972730520995",
      planType: null,
      organizationTitle: null,
      authMode: "chatgpt",
    }),
    "dev.gurata@gmail.com"
  );
});

test("formatUsageWindowSummary lists remaining usage by window", () => {
  assert.equal(
    formatUsageWindowSummary([
      {
        status: "ok",
        windowMinutes: 300,
        usedPercent: 45,
        remainingPercent: 55,
        resetAt: "2026-04-03T12:00:00.000Z",
      },
      {
        status: "ok",
        windowMinutes: 10080,
        usedPercent: 10,
        remainingPercent: 90,
        resetAt: "2026-04-10T12:00:00.000Z",
      },
    ]),
    "5H 55% 남음 · 7D 90% 남음"
  );
});

test("formatUsageWindowSummary keeps unavailable windows visible", () => {
  assert.equal(
    formatUsageWindowSummary([
      {
        status: "unavailable",
        windowMinutes: 300,
        usedPercent: null,
        remainingPercent: null,
        resetAt: null,
      },
      {
        status: "unavailable",
        windowMinutes: 10080,
        usedPercent: null,
        remainingPercent: null,
        resetAt: null,
      },
    ]),
    "5H 확인 불가 · 7D 확인 불가"
  );
});
