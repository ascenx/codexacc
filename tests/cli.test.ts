import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

describe("runCli", () => {
  it("prints help", async () => {
    const result = await runCli(["--help"], { HOME: "/tmp/codexacc-test" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("codexacc <command>");
    expect(result.stdout).toContain("add <name>");
    expect(result.stdout).toContain("remove <name>");
    expect(result.stdout).toContain("rm <name>");
    expect(result.stdout).toContain("run <name>");
    expect(result.stdout).toContain("current-home");
    expect(result.stdout).toContain("shell-hook");
    expect(result.stdout).toContain("install-shell");
    expect(result.stdout).toContain("limits --refresh");
    expect(result.stderr).toBe("");
  });

  it("rejects unknown commands", async () => {
    const result = await runCli(["wat"], { HOME: "/tmp/codexacc-test" });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command: wat");
    expect(result.stdout).toContain("codexacc <command>");
  });
});

describe("account commands", () => {
  it("sets current account for use", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const env = { HOME: base };

    await runCli(["add", "work"], env, { runCodex: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
    const useResult = await runCli(["use", "work"], env);
    const currentHomeResult = await runCli(["current-home"], env);

    expect(useResult).toEqual({
      exitCode: 0,
      stdout: "Using account work\n",
      stderr: "",
    });
    expect(currentHomeResult).toEqual({
      exitCode: 0,
      stdout: `${path.join(base, ".codexacc", "accounts", "work", "home")}\n`,
      stderr: "",
    });
  });

  it("lists accounts with mocked login status", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const env = { HOME: base };

    await runCli(["add", "work"], env, { runCodex: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
    const result = await runCli(["list"], env, {
      runCodex: async () => ({ exitCode: 0, stdout: "Logged in using ChatGPT\n", stderr: "" }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("work");
    expect(result.stdout).toContain("Logged in using ChatGPT");
  });

  it("marks persisted current account active in list", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const env = { HOME: base };

    await runCli(["add", "work"], env, { runCodex: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
    await runCli(["use", "work"], env);
    const result = await runCli(["list"], env, {
      runCodex: async () => ({ exitCode: 0, stdout: "Logged in using ChatGPT\n", stderr: "" }),
    });

    expect(result.stdout).toContain("work\t*\tLogged in using ChatGPT");
  });

  it("lists login status that codex writes to stderr", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const env = { HOME: base };

    await runCli(["add", "work"], env, { runCodex: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
    const result = await runCli(["list"], env, {
      runCodex: async () => ({ exitCode: 0, stdout: "", stderr: "Logged in using ChatGPT\n" }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("work");
    expect(result.stdout).toContain("Logged in using ChatGPT");
  });

  it("does not keep an account when add login fails", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const env = { HOME: base };

    const addResult = await runCli(["add", "work"], env, {
      runCodex: async () => ({ exitCode: 1, stdout: "", stderr: "login failed\n" }),
    });
    const listResult = await runCli(["list"], env);

    expect(addResult.exitCode).toBe(1);
    expect(addResult.stderr).toContain("login failed");
    expect(addResult.stderr).toContain("Removed incomplete account work");
    expect(listResult.stdout).toBe("No accounts found\n");
  });

  it("removes an account", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const env = { HOME: base };

    await runCli(["add", "work"], env, { runCodex: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
    const removeResult = await runCli(["remove", "work"], env);
    const useResult = await runCli(["use", "work"], env);

    expect(removeResult).toEqual({ exitCode: 0, stdout: "Removed account work\n", stderr: "" });
    expect(useResult.exitCode).toBe(1);
    expect(useResult.stderr).toContain("Account not found: work");
  });

  it("prints a shell hook that wraps codex", async () => {
    const result = await runCli(["shell-hook"], { HOME: "/tmp/codexacc-test" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("codex()");
    expect(result.stdout).toContain("unalias codex");
    expect(result.stdout).toContain("command codexacc current-home");
    expect(result.stdout).toContain("CODEX_HOME=");
    expect(result.stderr).toBe("");
  });

  it("installs shell hook into zshrc idempotently", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const env = { HOME: base, SHELL: "/bin/zsh" };

    const first = await runCli(["install-shell"], env);
    const second = await runCli(["install-shell"], env);
    const zshrc = await readFile(path.join(base, ".zshrc"), "utf8");

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(zshrc.match(/codexacc shell integration/g)).toHaveLength(2);
    expect(zshrc).toContain("command codexacc current-home");
  });

  it("forwards run args to codex", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const env = { HOME: base };
    const calls: Array<{ home: string; args: string[] }> = [];

    await runCli(["add", "work"], env, { runCodex: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
    const result = await runCli(["run", "work", "exec", "hello"], env, {
      runCodex: async (home, args) => {
        calls.push({ home, args });
        return { exitCode: 7, stdout: "out\n", stderr: "err\n" };
      },
    });

    expect(calls).toEqual([
      {
        home: path.join(base, ".codexacc", "accounts", "work", "home"),
        args: ["exec", "hello"],
      },
    ]);
    expect(result).toEqual({ exitCode: 7, stdout: "out\n", stderr: "err\n" });
  });

  it("runs interactive codex with inherited stdio", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const env = { HOME: base };
    const calls: Array<{ home: string; args: string[]; stdio?: string }> = [];

    await runCli(["add", "work"], env, { runCodex: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
    const result = await runCli(["run", "work"], env, {
      runCodex: async (home, args, _env, options) => {
        calls.push({ home, args, stdio: options?.stdio });
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(calls).toEqual([
      {
        home: path.join(base, ".codexacc", "accounts", "work", "home"),
        args: [],
        stdio: "inherit",
      },
    ]);
  });
});

describe("limits command", () => {
  it("prints unknown when an account has no local limit data", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const env = { HOME: base };

    await runCli(["add", "work"], env, { runCodex: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
    const result = await runCli(["limits"], env);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("account  5h");
    expect(result.stdout).toContain("weekly");
    expect(result.stdout).toContain("PLAN");
    expect(result.stdout).toContain("work     unknown  unknown  unknown");
  });

  it("refreshes accounts before printing limits", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const env = { HOME: base };
    const calls: Array<{ home: string; args: string[] }> = [];

    await runCli(["add", "work"], env, { runCodex: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
    const result = await runCli(["limits", "--refresh"], env, {
      runCodex: async (home, args) => {
        calls.push({ home, args });
        return {
          exitCode: 0,
          stdout: `{"timestamp":"${new Date(Date.now() + 1000).toISOString()}","type":"event_msg","payload":{"rate_limits":{"primary":{"used_percent":4,"window_minutes":300,"resets_at":1776362700},"secondary":{"used_percent":12,"window_minutes":10080,"resets_at":1776967500},"plan_type":"plus"}}}\n`,
          stderr: "",
        };
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("work");
    expect(result.stdout).toContain("96%,");
    expect(result.stdout).toContain("88%,");
    expect(result.stdout).toContain("Plus");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args.slice(0, 3)).toEqual(["exec", "--skip-git-repo-check", "-o"]);
    expect(calls[0]?.args.at(-1)).toBe("Return exactly ok and nothing else.");
  });

  it("does not reuse stale cached limits after refresh", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const env = { HOME: base };

    await runCli(["add", "work"], env, { runCodex: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
    const sessionDir = path.join(base, ".codexacc", "accounts", "work", "home", "sessions", "2026", "04", "17");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, "old.jsonl"),
      '{"timestamp":"2026-04-17T01:05:00.000Z","type":"event_msg","payload":{"rate_limits":{"primary":{"used_percent":4,"window_minutes":300,"resets_at":1776362700},"secondary":{"used_percent":12,"window_minutes":10080,"resets_at":1776967500},"plan_type":"plus"}}}\n',
    );

    const result = await runCli(["limits", "--refresh"], env, {
      runCodex: async () => ({ exitCode: 0, stdout: "ok\n", stderr: "" }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Refresh did not produce limit data for work");
    expect(result.stdout).toContain("work     unknown  unknown  unknown");
  });

  it("reports refresh progress", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const env = { HOME: base };
    const progress: string[] = [];

    await runCli(["add", "work"], env, { runCodex: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
    await runCli(["limits", "--refresh"], env, {
      onProgress: (message) => progress.push(message),
      runCodex: async () => ({
        exitCode: 0,
        stdout: `{"timestamp":"${new Date(Date.now() + 1000).toISOString()}","type":"event_msg","payload":{"rate_limits":{"primary":{"used_percent":4,"window_minutes":300,"resets_at":1776362700},"secondary":{"used_percent":12,"window_minutes":10080,"resets_at":1776967500},"plan_type":"plus"}}}\n`,
        stderr: "",
      }),
    });

    expect(progress).toContain("Refreshing work...\n");
    expect(progress).toContain("Refreshed work\n");
  });

  it("times out a stuck refresh", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const env = { HOME: base, CODEXACC_REFRESH_TIMEOUT_MS: "5" };

    await runCli(["add", "work"], env, { runCodex: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
    const result = await runCli(["limits", "--refresh"], env, {
      runCodex: async () => new Promise(() => undefined),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Refresh failed for work");
    expect(result.stderr).toContain("timed out after 5ms");
  });
});

describe("user-facing errors", () => {
  it("fails use for missing account", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const result = await runCli(["use", "missing"], { HOME: base });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Account not found: missing");
  });

  it("rejects invalid add names", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const result = await runCli(["add", "../bad"], { HOME: base });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Account name may only contain letters");
  });
});
