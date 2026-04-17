import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAccountHome, getAccountRoot, getAccountsRoot, validateAccountName } from "./paths.js";

export interface AccountMetadata {
  name: string;
  createdAt: string;
  home: string;
}

export interface CurrentAccount {
  name: string;
  home: string;
}

function getCurrentPath(storeRoot: string): string {
  return path.join(storeRoot, "current.json");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function createAccount(storeRoot: string, name: string, now = new Date()): Promise<AccountMetadata> {
  const validation = validateAccountName(name);
  if (!validation.ok) throw new Error(validation.reason);

  const accountRoot = getAccountRoot(storeRoot, name);
  const home = getAccountHome(storeRoot, name);
  const metadataPath = path.join(accountRoot, "metadata.json");

  if (await pathExists(accountRoot)) {
    throw new Error(`Account already exists: ${name}`);
  }

  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(accountRoot, 0o700).catch(() => undefined);
  await chmod(home, 0o700).catch(() => undefined);

  const metadata: AccountMetadata = {
    name,
    createdAt: now.toISOString(),
    home,
  };

  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  return metadata;
}

export async function readAccount(storeRoot: string, name: string): Promise<AccountMetadata> {
  const accountRoot = getAccountRoot(storeRoot, name);
  const metadataPath = path.join(accountRoot, "metadata.json");
  if (!(await pathExists(metadataPath))) throw new Error(`Account not found: ${name}`);
  const raw = await readFile(metadataPath, "utf8");
  const parsed = JSON.parse(raw) as AccountMetadata;
  return parsed;
}

export async function removeAccount(storeRoot: string, name: string): Promise<void> {
  const validation = validateAccountName(name);
  if (!validation.ok) throw new Error(validation.reason);

  const accountRoot = getAccountRoot(storeRoot, name);
  const metadataPath = path.join(accountRoot, "metadata.json");
  if (!(await pathExists(metadataPath))) throw new Error(`Account not found: ${name}`);

  await rm(accountRoot, { recursive: true, force: true });

  const current = await readCurrentAccount(storeRoot);
  if (current?.name === name) await clearCurrentAccount(storeRoot);
}

export async function setCurrentAccount(storeRoot: string, account: AccountMetadata): Promise<void> {
  await mkdir(storeRoot, { recursive: true, mode: 0o700 });
  await chmod(storeRoot, 0o700).catch(() => undefined);
  const current: CurrentAccount = { name: account.name, home: account.home };
  await writeFile(getCurrentPath(storeRoot), `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
}

export async function readCurrentAccount(storeRoot: string): Promise<CurrentAccount | null> {
  const currentPath = getCurrentPath(storeRoot);
  if (!(await pathExists(currentPath))) return null;

  const raw = await readFile(currentPath, "utf8");
  const parsed = JSON.parse(raw) as CurrentAccount;
  return parsed;
}

export async function clearCurrentAccount(storeRoot: string): Promise<void> {
  await unlink(getCurrentPath(storeRoot)).catch(() => undefined);
}

export async function listAccounts(storeRoot: string): Promise<AccountMetadata[]> {
  const accountsRoot = getAccountsRoot(storeRoot);
  if (!(await pathExists(accountsRoot))) return [];

  const names = await readdir(accountsRoot);
  const accounts: AccountMetadata[] = [];

  for (const name of names) {
    const accountRoot = getAccountRoot(storeRoot, name);
    if (!(await stat(accountRoot)).isDirectory()) continue;
    try {
      accounts.push(await readAccount(storeRoot, name));
    } catch {
      continue;
    }
  }

  return accounts.sort((a, b) => a.name.localeCompare(b.name));
}
