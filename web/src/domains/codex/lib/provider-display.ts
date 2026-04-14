import type {
  CliInstallMethod,
  CliVersionDiagnosticsRecord,
  ProviderAccountInfoRecord,
  ProviderKind,
  ProviderUsageSummaryRecord,
  ProviderStatusUsageWindowRecord,
  RuntimeKind,
  RuntimeOllamaLaunchTarget,
} from "../types.js";

export function providerLabel(provider: ProviderKind): string {
  if (provider === "codex") {
    return "Codex";
  }

  if (provider === "claude") {
    return "Claude";
  }

  return "Ollama";
}

export function runtimeLabel(runtimeKind: RuntimeKind): string {
  if (runtimeKind === "codex-cli") {
    return "Codex CLI";
  }

  if (runtimeKind === "claude-code") {
    return "Claude Code";
  }

  return "Ollama";
}

export function runtimeShortLabel(runtimeKind: RuntimeKind): string {
  if (runtimeKind === "codex-cli") {
    return "Codex";
  }

  if (runtimeKind === "claude-code") {
    return "Claude";
  }

  return "Ollama";
}

export function ollamaLaunchTargetLabel(
  target: RuntimeOllamaLaunchTarget | null | undefined
): string {
  return target === "claude" ? "Claude" : "Codex";
}

export function providerAccentClasses(provider: ProviderKind): string {
  if (provider === "codex") {
    return "border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300";
  }

  if (provider === "claude") {
    return "border-orange-500/30 bg-orange-500/8 text-orange-700 dark:text-orange-300";
  }

  return "border-sky-500/30 bg-sky-500/8 text-sky-700 dark:text-sky-300";
}

export function providerAccountLabel(info: ProviderAccountInfoRecord): string | null {
  return info.email ?? info.label ?? info.name ?? info.userId ?? null;
}

export function formatUsageWindowSummary(
  windows: ProviderStatusUsageWindowRecord[]
): string | null {
  const parts = windows.map((window) => {
    const windowLabel =
      window.windowMinutes === 300
        ? "5H"
        : window.windowMinutes === 10080
          ? "7D"
          : `${window.windowMinutes}m`;

    return `${windowLabel} ${formatUsageHeadline(window)}`;
  });

  return parts.length > 0 ? parts.join(" · ") : null;
}

export function installMethodLabel(installMethod: CliInstallMethod): string {
  switch (installMethod) {
    case "homebrew-cask":
      return "Homebrew";
    case "npm-global":
      return "npm";
    default:
      return "수동 설치";
  }
}

export function formatCliDiagnosticsSummary(
  diagnostics: CliVersionDiagnosticsRecord
): string {
  if (diagnostics.installStatus !== "installed") {
    return diagnostics.statusText;
  }

  if (diagnostics.latestStatus === "update-available" && diagnostics.latestVersion) {
    return `업데이트 가능: ${diagnostics.currentVersion ?? "설치됨"} -> ${diagnostics.latestVersion}`;
  }

  if (diagnostics.latestStatus === "current") {
    return `최신 버전: ${diagnostics.currentVersion ?? "설치됨"}`;
  }

  return diagnostics.statusText;
}

export function formatUsageHeadline(window: ProviderStatusUsageWindowRecord): string {
  if (window.remainingPercent === null) {
    return window.resetAt ? "퍼센트 미제공" : "확인 불가";
  }

  return `${Math.round(window.remainingPercent)}% 남음`;
}

function formatCompactMetric(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  }

  return value.toLocaleString("ko-KR");
}

function formatUsd(value: number): string {
  if (value >= 100) {
    return `$${value.toFixed(0)}`;
  }

  if (value >= 10) {
    return `$${value.toFixed(1)}`;
  }

  return `$${value.toFixed(2)}`;
}

export function formatUsageSummary(summary: ProviderUsageSummaryRecord | null): string | null {
  if (!summary) {
    return null;
  }

  const parts: string[] = [];
  if (summary.totalMessages) {
    parts.push(`메시지 ${formatCompactMetric(summary.totalMessages)}`);
  }
  if (summary.totalSessions) {
    parts.push(`세션 ${formatCompactMetric(summary.totalSessions)}`);
  }
  if (summary.totalTokens) {
    parts.push(`토큰 ${formatCompactMetric(summary.totalTokens)}`);
  }
  if (summary.totalCostUsd) {
    parts.push(`비용 ${formatUsd(summary.totalCostUsd)}`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}
