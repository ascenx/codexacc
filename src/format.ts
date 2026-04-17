import type { LimitSnapshot, LimitWindow } from "./limits.js";

export interface LimitTableRow {
  name: string;
  snapshot: LimitSnapshot | null;
}

export interface LimitTableOptions {
  timeZone?: string;
  now?: Date;
}

export interface LimitChoiceSummary {
  fiveHour: string;
  weekly: string;
  plan: string;
}

interface ResetParts {
  month: string;
  day: string;
  hour: string;
  minute: string;
  monthName: string;
}

interface CardLine {
  text: string;
}

const BAR_WIDTH = 20;
const LABEL_WIDTH = 21;

function remainingPercent(value: number | undefined): number | null {
  if (typeof value !== "number") return null;
  const remaining = Math.max(0, Math.min(100, 100 - value));
  return Number(remaining.toFixed(1));
}

function getResetParts(seconds: number, options: LimitTableOptions): ResetParts {
  const numericParts = new Intl.DateTimeFormat("en-US", {
    timeZone: options.timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(seconds * 1000));

  const monthNameParts = new Intl.DateTimeFormat("en-US", {
    timeZone: options.timeZone,
    month: "short",
  }).formatToParts(new Date(seconds * 1000));

  const numericValues = Object.fromEntries(numericParts.map((part) => [part.type, part.value]));
  const monthNameValues = Object.fromEntries(monthNameParts.map((part) => [part.type, part.value]));

  return {
    month: numericValues.month,
    day: numericValues.day,
    hour: numericValues.hour,
    minute: numericValues.minute,
    monthName: monthNameValues.month,
  };
}

function formatReset(seconds: number | undefined, options: LimitTableOptions): string | null {
  if (typeof seconds !== "number") return null;

  const reset = getResetParts(seconds, options);
  const nowSeconds = (options.now ?? new Date()).getTime() / 1000;
  const now = getResetParts(nowSeconds, options);
  const time = `${reset.hour}:${reset.minute}`;

  if (reset.month === now.month && reset.day === now.day) return time;
  return `${time} on ${Number(reset.day)} ${reset.monthName}`;
}

function progressBar(percent: number): string {
  const filled = Math.round((percent / 100) * BAR_WIDTH);
  return `[${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}]`;
}

function formatPercent(percent: number): string {
  return `${Number(percent.toFixed(1))}%`;
}

function formatWindow(window: LimitWindow | null | undefined, options: LimitTableOptions): string {
  if (!window) return "unknown";

  const percent = remainingPercent(window.used_percent);
  if (percent === null) return "unknown";

  const reset = formatReset(window.resets_at, options);
  const resetText = reset ? ` (resets ${reset})` : "";
  return `${progressBar(percent)} ${formatPercent(percent)} left${resetText}`;
}

function formatShortWindow(window: LimitWindow | null | undefined): string {
  if (!window) return "unknown";

  const percent = remainingPercent(window.used_percent);
  return percent === null ? "unknown" : formatPercent(percent);
}

function formatPlan(plan: string | null | undefined): string {
  if (!plan) return "unknown";
  return plan
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function accountTitle(row: LimitTableRow): string {
  const plan = row.snapshot ? formatPlan(row.snapshot.rateLimits.plan_type) : "unknown";
  const value = plan === "unknown" ? row.name : `${row.name} (${plan})`;
  return formatField("Account:", value);
}

function formatField(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH, " ")}${value}`;
}

function cardLines(rows: LimitTableRow[], options: LimitTableOptions): CardLine[] {
  const lines: CardLine[] = [{ text: "  >_ codexacc limits" }, { text: "" }];

  for (const [index, row] of rows.entries()) {
    if (index > 0) lines.push({ text: "" });
    lines.push({ text: accountTitle(row) });
    lines.push({ text: formatField("5h limit:", formatWindow(row.snapshot?.rateLimits.primary, options)) });
    lines.push({ text: formatField("Weekly limit:", formatWindow(row.snapshot?.rateLimits.secondary, options)) });
  }

  return lines;
}

function border(width: number): string {
  return `─`.repeat(width + 2);
}

function framed(lines: CardLine[]): string {
  const contentWidth = Math.max(...lines.map((line) => line.text.length));
  const horizontal = border(contentWidth);
  const body = lines.map((line) => `│ ${line.text.padEnd(contentWidth, " ")} │`);
  return `${[`╭${horizontal}╮`, ...body, `╰${horizontal}╯`].join("\n")}\n`;
}

export function formatLimitTable(rows: LimitTableRow[], options: LimitTableOptions = {}): string {
  return framed(cardLines(rows, options));
}

export function formatLimitChoice(snapshot: LimitSnapshot | null): LimitChoiceSummary {
  if (!snapshot) {
    return {
      fiveHour: "unknown",
      weekly: "unknown",
      plan: "unknown",
    };
  }

  return {
    fiveHour: formatShortWindow(snapshot.rateLimits.primary),
    weekly: formatShortWindow(snapshot.rateLimits.secondary),
    plan: formatPlan(snapshot.rateLimits.plan_type),
  };
}
