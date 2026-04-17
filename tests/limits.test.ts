import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatLimitChoice, formatLimitTable } from "../src/format.js";
import { findLatestLimitsForHome } from "../src/limits.js";

describe("limits", () => {
  it("finds the newest rate_limits event under sessions", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const sessionDir = path.join(base, "sessions", "2026", "04", "17");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, "rollout.jsonl"),
      [
        '{"timestamp":"2026-04-17T01:00:00.000Z","type":"event_msg","payload":{"rate_limits":{"primary":{"used_percent":2,"window_minutes":300,"resets_at":1776362400},"secondary":{"used_percent":11,"window_minutes":10080,"resets_at":1776967200},"plan_type":"plus"}}}',
        '{"timestamp":"2026-04-17T01:05:00.000Z","type":"event_msg","payload":{"rate_limits":{"primary":{"used_percent":4,"window_minutes":300,"resets_at":1776362700},"secondary":{"used_percent":12,"window_minutes":10080,"resets_at":1776967500},"plan_type":"plus"}}}',
        "not json",
      ].join("\n"),
    );

    const latest = await findLatestLimitsForHome(base);

    expect(latest?.timestamp).toBe("2026-04-17T01:05:00.000Z");
    expect(latest?.rateLimits.primary?.used_percent).toBe(4);
    expect(latest?.rateLimits.secondary?.window_minutes).toBe(10080);
  });

  it("returns null when no session data exists", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));

    await expect(findLatestLimitsForHome(base)).resolves.toBeNull();
  });

  it("formats limits as status-style cards", () => {
    const output = formatLimitTable(
      [
        {
          name: "work",
          snapshot: {
            timestamp: "2026-04-17T01:05:00.000Z",
            rateLimits: {
              primary: { used_percent: 4, window_minutes: 300, resets_at: 1776362700 },
              secondary: { used_percent: 12, window_minutes: 10080, resets_at: 1776967500 },
              plan_type: "plus",
            },
          },
        },
      ],
      { timeZone: "Asia/Shanghai", now: new Date("2026-04-17T01:00:00.000Z") },
    );

    expect(output).toBe(
      [
        "╭─────────────────────────────────────────────────────────────────────────────────╮",
        "│   >_ codexacc limits                                                            │",
        "│                                                                                 │",
        "│   Account:             work (Plus)                                              │",
        "│   5h limit:            [███████████████████░] 96% left (resets 02:05)           │",
        "│   Weekly limit:        [██████████████████░░] 88% left (resets 02:05 on 24 Apr) │",
        "╰─────────────────────────────────────────────────────────────────────────────────╯",
        "",
      ].join("\n"),
    );
  });

  it("formats missing limits as unknown", () => {
    const output = formatLimitTable([
      {
        name: "work",
        snapshot: null,
      },
    ]);

    expect(output).toBe(
      [
        "╭────────────────────────────────╮",
        "│   >_ codexacc limits           │",
        "│                                │",
        "│   Account:             work    │",
        "│   5h limit:            unknown │",
        "│   Weekly limit:        unknown │",
        "╰────────────────────────────────╯",
        "",
      ].join("\n"),
    );
  });

  it("formats used_percent as remaining percent", () => {
    const output = formatLimitTable([
      {
        name: "work",
        snapshot: {
          timestamp: "2026-04-17T01:05:00.000Z",
          rateLimits: {
            primary: { used_percent: 75, window_minutes: 300, resets_at: 1776362700 },
            secondary: { used_percent: 42, window_minutes: 10080, resets_at: 1776967500 },
            plan_type: "plus",
          },
        },
      },
    ]);

    expect(output).toContain("25% left");
    expect(output).toContain("58% left");
  });

  it("formats compact limit values for account selection", () => {
    const summary = formatLimitChoice({
      timestamp: "2026-04-17T01:05:00.000Z",
      rateLimits: {
        primary: { used_percent: 75, window_minutes: 300, resets_at: 1776362700 },
        secondary: { used_percent: 42, window_minutes: 10080, resets_at: 1776967500 },
        plan_type: "plus",
      },
    });

    expect(summary).toEqual({
      fiveHour: "25%",
      weekly: "58%",
      plan: "Plus",
    });
    expect(formatLimitChoice(null)).toEqual({
      fiveHour: "unknown",
      weekly: "unknown",
      plan: "unknown",
    });
  });
});
