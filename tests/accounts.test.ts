import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAccount, listAccounts, readCurrentAccount, removeAccount, setCurrentAccount } from "../src/accounts.js";
import { getAccountHome, getStoreRoot, validateAccountName } from "../src/paths.js";

describe("paths", () => {
  it("validates account names", () => {
    expect(validateAccountName("work")).toEqual({ ok: true });
    expect(validateAccountName("pro-20x")).toEqual({ ok: true });
    expect(validateAccountName("team.prod")).toEqual({ ok: true });
    expect(validateAccountName("")).toEqual({ ok: false, reason: "Account name is required" });
    expect(validateAccountName(".")).toEqual({ ok: false, reason: "Account name cannot be . or .." });
    expect(validateAccountName("../bad")).toEqual({
      ok: false,
      reason: "Account name may only contain letters, numbers, dot, underscore, and dash",
    });
  });

  it("resolves account homes under the store root", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const storeRoot = getStoreRoot({ HOME: base });

    expect(storeRoot).toBe(path.join(base, ".codexacc"));
    expect(getAccountHome(storeRoot, "work")).toBe(path.join(base, ".codexacc", "accounts", "work", "home"));
  });
});

describe("accounts", () => {
  it("creates an account home and metadata without secrets", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const storeRoot = getStoreRoot({ HOME: base });

    const account = await createAccount(storeRoot, "work", new Date("2026-04-17T00:00:00.000Z"));

    expect(account.name).toBe("work");
    expect(account.home).toBe(path.join(storeRoot, "accounts", "work", "home"));
    expect((await stat(account.home)).isDirectory()).toBe(true);

    const metadataRaw = await readFile(path.join(storeRoot, "accounts", "work", "metadata.json"), "utf8");
    expect(metadataRaw).not.toContain("access_token");
    expect(metadataRaw).not.toContain("refresh_token");
    expect(JSON.parse(metadataRaw)).toEqual({
      name: "work",
      createdAt: "2026-04-17T00:00:00.000Z",
      home: account.home,
    });
  });

  it("lists accounts by metadata", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const storeRoot = getStoreRoot({ HOME: base });

    await createAccount(storeRoot, "work", new Date("2026-04-17T00:00:00.000Z"));
    await createAccount(storeRoot, "pro", new Date("2026-04-17T00:01:00.000Z"));

    await expect(listAccounts(storeRoot)).resolves.toMatchObject([{ name: "pro" }, { name: "work" }]);
  });

  it("removes an account directory", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const storeRoot = getStoreRoot({ HOME: base });

    await createAccount(storeRoot, "work", new Date("2026-04-17T00:00:00.000Z"));
    await removeAccount(storeRoot, "work");

    await expect(listAccounts(storeRoot)).resolves.toEqual([]);
    await expect(stat(path.join(storeRoot, "accounts", "work"))).rejects.toThrow();
  });

  it("stores and reads the current account", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const storeRoot = getStoreRoot({ HOME: base });
    const account = await createAccount(storeRoot, "work", new Date("2026-04-17T00:00:00.000Z"));

    await setCurrentAccount(storeRoot, account);

    await expect(readCurrentAccount(storeRoot)).resolves.toEqual({
      name: "work",
      home: account.home,
    });
    const raw = await readFile(path.join(storeRoot, "current.json"), "utf8");
    expect(raw).not.toContain("access_token");
    expect(raw).not.toContain("refresh_token");
  });

  it("clears current account when removing it", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codexacc-"));
    const storeRoot = getStoreRoot({ HOME: base });
    const account = await createAccount(storeRoot, "work", new Date("2026-04-17T00:00:00.000Z"));

    await setCurrentAccount(storeRoot, account);
    await removeAccount(storeRoot, "work");

    await expect(readCurrentAccount(storeRoot)).resolves.toBeNull();
  });
});
