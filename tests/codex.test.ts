import { describe, expect, it } from "vitest";
import { buildCodexEnv, shellExportCode } from "../src/codex.js";

describe("codex helpers", () => {
  it("sets CODEX_HOME without mutating input env", () => {
    const env = { HOME: "/tmp/home", CODEX_HOME: "/old" };
    const next = buildCodexEnv(env, "/tmp/account/home");

    expect(next.CODEX_HOME).toBe("/tmp/account/home");
    expect(env.CODEX_HOME).toBe("/old");
  });

  it("prints shell-safe export code", () => {
    expect(shellExportCode("/tmp/account home")).toBe('export CODEX_HOME="/tmp/account home"\n');
    expect(shellExportCode('/tmp/a"b')).toBe('export CODEX_HOME="/tmp/a\\"b"\n');
  });
});
