import type { LimitSnapshot, LimitWindow } from "./limits.js";

export interface LimitTableRow {
  name: string;
  snapshot: LimitSnapshot | null;
}

export interface LimitTableOptions {
  timeZone?: string;
}

interface TableRow {
  name: string;
  fiveHour: string;
  weekly: string;
  plan: string;
}

function formatRemainingPercent(value: number | undefined): string {
  if (typeof value !== "number") return "unknown";
  const remaining = Math.max(0, Math.min(100, 100 - value));
  return `${Number(remaining.toFixed(1))}%`;
}

function formatReset(seconds: number | undefined, options: LimitTableOptions): string {
  if (typeof seconds !== "number") return "unknown";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: options.timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(seconds * 1000));

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function formatWindow(window: LimitWindow | null | undefined, options: LimitTableOptions): string {
  if (!window) return "unknown";
  return `${formatRemainingPercent(window.used_percent)}, ${formatReset(window.resets_at, options)}`;
}

function formatPlan(plan: string | null | undefined): string {
  if (!plan) return "unknown";
  return plan
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function pad(value: string, width: number): string {
  return value.padEnd(width, " ");
}

export function formatLimitTable(rows: LimitTableRow[], options: LimitTableOptions = {}): string {
  const tableRows: TableRow[] = rows.map((row) => ({
    name: row.name,
    fiveHour: row.snapshot ? formatWindow(row.snapshot.rateLimits.primary, options) : "unknown",
    weekly: row.snapshot ? formatWindow(row.snapshot.rateLimits.secondary, options) : "unknown",
    plan: row.snapshot ? formatPlan(row.snapshot.rateLimits.plan_type) : "unknown",
  }));

  const widths = {
    name: Math.max("account".length, ...tableRows.map((row) => row.name.length)),
    fiveHour: Math.max("5h".length, ...tableRows.map((row) => row.fiveHour.length)),
    weekly: Math.max("weekly".length, ...tableRows.map((row) => row.weekly.length)),
    plan: Math.max("PLAN".length, ...tableRows.map((row) => row.plan.length)),
  };

  const lines = [
    [pad("account", widths.name), pad("5h", widths.fiveHour), pad("weekly", widths.weekly), pad("PLAN", widths.plan)]
      .join("  ")
      .trimEnd(),
    ...tableRows.map((row) =>
      [pad(row.name, widths.name), pad(row.fiveHour, widths.fiveHour), pad(row.weekly, widths.weekly), pad(row.plan, widths.plan)]
        .join("  ")
        .trimEnd(),
    ),
  ];

  return `${lines.join("\n")}\n`;
}
