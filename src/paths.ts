import path from "node:path";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

const ACCOUNT_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

export function validateAccountName(name: string | undefined): ValidationResult {
  if (!name) return { ok: false, reason: "Account name is required" };
  if (name === "." || name === "..") return { ok: false, reason: "Account name cannot be . or .." };
  if (!ACCOUNT_NAME_PATTERN.test(name)) {
    return {
      ok: false,
      reason: "Account name may only contain letters, numbers, dot, underscore, and dash",
    };
  }
  return { ok: true };
}

export function getStoreRoot(env: Record<string, string | undefined>): string {
  if (env.CODEXACC_HOME) return path.resolve(env.CODEXACC_HOME);
  const home = env.HOME;
  if (!home) throw new Error("HOME is not set");
  return path.join(home, ".codexacc");
}

export function getAccountsRoot(storeRoot: string): string {
  return path.join(storeRoot, "accounts");
}

export function getAccountRoot(storeRoot: string, name: string): string {
  const accountsRoot = getAccountsRoot(storeRoot);
  const accountRoot = path.resolve(accountsRoot, name);
  const relative = path.relative(accountsRoot, accountRoot);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Resolved account path escaped the accounts directory");
  }
  return accountRoot;
}

export function getAccountHome(storeRoot: string, name: string): string {
  return path.join(getAccountRoot(storeRoot, name), "home");
}
