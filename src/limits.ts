import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface LimitWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
}

export interface RateLimits {
  limit_id?: string | null;
  limit_name?: string | null;
  primary?: LimitWindow | null;
  secondary?: LimitWindow | null;
  credits?: unknown;
  plan_type?: string | null;
}

export interface LimitSnapshot {
  timestamp: string;
  rateLimits: RateLimits;
}

async function collectJsonlFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsonlFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseSnapshotLine(line: string): LimitSnapshot | null {
  try {
    const parsed = JSON.parse(line) as {
      timestamp?: string;
      payload?: { rate_limits?: RateLimits | null };
    };
    if (!parsed.timestamp || !parsed.payload?.rate_limits) return null;
    return {
      timestamp: parsed.timestamp,
      rateLimits: parsed.payload.rate_limits,
    };
  } catch {
    return null;
  }
}

export function findLatestLimitsInJsonl(raw: string): LimitSnapshot | null {
  let latest: LimitSnapshot | null = null;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const snapshot = parseSnapshotLine(line);
    if (!snapshot) continue;
    if (!latest || snapshot.timestamp > latest.timestamp) latest = snapshot;
  }

  return latest;
}

export async function findLatestLimitsForHome(accountHome: string): Promise<LimitSnapshot | null> {
  const sessionRoot = path.join(accountHome, "sessions");
  const files = await collectJsonlFiles(sessionRoot);
  let latest: LimitSnapshot | null = null;

  for (const file of files) {
    const raw = await readFile(file, "utf8");
    const snapshot = findLatestLimitsInJsonl(raw);
    if (snapshot && (!latest || snapshot.timestamp > latest.timestamp)) latest = snapshot;
  }

  return latest;
}
