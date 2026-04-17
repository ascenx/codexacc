import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatLimitTable } from "../src/format.js";
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

  it("formats limits as a compact local-time table", () => {
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
      { timeZone: "Asia/Shanghai" },
    );

    expect(output).toBe(
      [
        "account  5h                weekly            PLAN",
        "work     96%, 04-17 02:05  88%, 04-24 02:05  Plus",
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

    expect(output).toBe(["account  5h       weekly   PLAN", "work     unknown  unknown  unknown", ""].join("\n"));
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

    expect(output).toContain("25%,");
    expect(output).toContain("58%,");
  });
});
