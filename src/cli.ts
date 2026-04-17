import { tmpdir } from "node:os";
import path from "node:path";
import { createAccount, listAccounts, readAccount, readCurrentAccount, removeAccount, setCurrentAccount, type AccountMetadata } from "./accounts.js";
import { runCodexProcess, type ProcessResult, type RunCodexOptions } from "./codex.js";
import { formatLimitChoice, formatLimitTable, type LimitTableRow } from "./format.js";
import { findLatestLimitsForHome, findLatestLimitsInJsonl, type LimitSnapshot } from "./limits.js";
import { getStoreRoot } from "./paths.js";
import { selectAccount, type AccountSelectionChoice, type AccountSelectionCommand } from "./prompt.js";
import { installShellHook, shellHook } from "./shell.js";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CliEnv = Record<string, string | undefined>;

export interface CliDeps {
  runCodex?: (accountHome: string, args: string[], env: CliEnv, options?: RunCodexOptions) => Promise<ProcessResult>;
  onProgress?: (message: string) => void;
  selectAccount?: (command: AccountSelectionCommand, choices: AccountSelectionChoice[]) => Promise<string | null>;
}

const HELP = `codexacc <command>

Commands:
  add <name>            Create an isolated Codex account home and run codex login
  remove <name>         Remove a managed account home
  rm <name>             Alias for remove
  run [name] [args...]  Run codex with the selected account
  use [name]            Set the default account for the shell hook
  current-home          Print the selected account CODEX_HOME for shell hooks
  shell-hook            Print shell integration code
  install-shell         Install shell integration into ~/.zshrc
  list                  List managed accounts
  limits                Show cached last-known account limit usage
  limits --refresh      Run a tiny prompt per account before showing limits
  help                  Show this help
`;

const LIMIT_REFRESH_PROMPT = "Return exactly ok and nothing else.";
const DEFAULT_REFRESH_TIMEOUT_MS = 120_000;

function getRefreshTimeoutMs(env: CliEnv): number {
  const raw = env.CODEXACC_REFRESH_TIMEOUT_MS;
  if (!raw) return DEFAULT_REFRESH_TIMEOUT_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_REFRESH_TIMEOUT_MS;
  return parsed;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`codex command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function errorResult(message: string): CliResult {
  return { exitCode: 1, stdout: "", stderr: `${message}\n` };
}

async function resolveAccountName(
  command: AccountSelectionCommand,
  storeRoot: string,
  providedName: string | undefined,
  select: (command: AccountSelectionCommand, choices: AccountSelectionChoice[]) => Promise<string | null>,
): Promise<string> {
  if (providedName) return providedName;

  const accounts = await listAccounts(storeRoot);
  if (accounts.length === 0) throw new Error("No accounts found");

  const choices = await buildAccountChoices(accounts);
  const selected = await select(command, choices);
  if (!selected) throw new Error("Account name is required");
  return selected;
}

async function buildAccountChoices(accounts: AccountMetadata[]): Promise<AccountSelectionChoice[]> {
  return Promise.all(
    accounts.map(async (account) => ({
      account,
      ...formatLimitChoice(await findLatestLimitsForHome(account.home)),
    })),
  );
}

export async function runCli(args: string[], env: CliEnv, deps: CliDeps = {}): Promise<CliResult> {
  const runCodex = deps.runCodex ?? runCodexProcess;
  const onProgress = deps.onProgress;
  const chooseAccount = deps.selectAccount ?? selectAccount;
  const command = args[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    return { exitCode: 0, stdout: HELP, stderr: "" };
  }

  if (command === "add") {
    const name = args[1];
    try {
      const storeRoot = getStoreRoot(env);
      const account = await createAccount(storeRoot, name);
      const login = await runCodex(account.home, ["login"], env);
      if (login.exitCode !== 0) {
        await removeAccount(storeRoot, account.name);
        return {
          exitCode: login.exitCode,
          stdout: login.stdout,
          stderr: `${login.stderr}Removed incomplete account ${account.name}\n`,
        };
      }
      return {
        exitCode: login.exitCode,
        stdout: `Created account ${account.name} at ${account.home}\n${login.stdout}`,
        stderr: login.stderr,
      };
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  }

  if (command === "remove" || command === "rm") {
    try {
      const name = args[1];
      await removeAccount(getStoreRoot(env), name);
      return { exitCode: 0, stdout: `Removed account ${name}\n`, stderr: "" };
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  }

  if (command === "use") {
    try {
      const storeRoot = getStoreRoot(env);
      const accountName = await resolveAccountName("use", storeRoot, args[1], chooseAccount);
      const account = await readAccount(storeRoot, accountName);
      await setCurrentAccount(storeRoot, account);
      return { exitCode: 0, stdout: `Using account ${account.name}\n`, stderr: "" };
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  }

  if (command === "current-home") {
    try {
      const current = await readCurrentAccount(getStoreRoot(env));
      if (!current) return errorResult("No current account selected");
      return { exitCode: 0, stdout: `${current.home}\n`, stderr: "" };
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  }

  if (command === "shell-hook") {
    return { exitCode: 0, stdout: shellHook(), stderr: "" };
  }

  if (command === "install-shell") {
    try {
      const zshrcPath = await installShellHook(env);
      return { exitCode: 0, stdout: `Installed codexacc shell hook in ${zshrcPath}\nRun: source ~/.zshrc\n`, stderr: "" };
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  }

  if (command === "run") {
    try {
      const storeRoot = getStoreRoot(env);
      const accountName = await resolveAccountName("run", storeRoot, args[1], chooseAccount);
      const account = await readAccount(storeRoot, accountName);
      const codexArgs = args.slice(2);
      return await runCodex(account.home, codexArgs, env, codexArgs.length === 0 ? { stdio: "inherit" } : undefined);
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  }

  if (command === "list") {
    const storeRoot = getStoreRoot(env);
    const accounts = await listAccounts(storeRoot);
    if (accounts.length === 0) return { exitCode: 0, stdout: "No accounts found\n", stderr: "" };
    const current = await readCurrentAccount(storeRoot);

    const lines = ["NAME\tACTIVE\tLOGIN\tHOME"];
    for (const account of accounts) {
      const status = await runCodex(account.home, ["login", "status"], env);
      const active = env.CODEX_HOME === account.home || current?.home === account.home ? "*" : "";
      const login = status.exitCode === 0 ? `${status.stdout}${status.stderr}`.trim() : "Not logged in";
      lines.push(`${account.name}\t${active}\t${login}\t${account.home}`);
    }
    return { exitCode: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
  }

  if (command === "limits") {
    const accounts = await listAccounts(getStoreRoot(env));
    if (accounts.length === 0) return { exitCode: 0, stdout: "No accounts found\n", stderr: "" };

    const refresh = args[1] === "--refresh";
    const refreshTimeoutMs = getRefreshTimeoutMs(env);
    let stderr = "";
    let exitCode = 0;

    const rows: LimitTableRow[] = [];
    for (const account of accounts) {
      let refreshSnapshot: LimitSnapshot | null = null;
      if (refresh) {
        onProgress?.(`Refreshing ${account.name}...\n`);
        const refreshStartedAt = new Date().toISOString();
        const outputPath = path.join(tmpdir(), `codexacc-limit-${account.name}-${process.pid}-${Date.now()}.txt`);
        let result: ProcessResult;
        try {
          result = await withTimeout(
            runCodex(
              account.home,
              ["exec", "--skip-git-repo-check", "-o", outputPath, LIMIT_REFRESH_PROMPT],
              env,
              { timeoutMs: refreshTimeoutMs },
            ),
            refreshTimeoutMs,
          );
        } catch (error) {
          result = {
            exitCode: 124,
            stdout: "",
            stderr: error instanceof Error ? `${error.message}\n` : `${String(error)}\n`,
          };
        }

        if (result.exitCode === 0) {
          const directSnapshot = findLatestLimitsInJsonl(result.stdout);
          const cachedSnapshot = await findLatestLimitsForHome(account.home);
          const candidate = directSnapshot ?? cachedSnapshot;

          if (candidate && candidate.timestamp >= refreshStartedAt) {
            refreshSnapshot = candidate;
            onProgress?.(`Refreshed ${account.name}\n`);
          } else {
            exitCode = 1;
            stderr += `Refresh did not produce limit data for ${account.name}\n`;
            onProgress?.(`Refresh produced no limit data for ${account.name}\n`);
          }
        } else {
          exitCode = 1;
          stderr += `Refresh failed for ${account.name}: ${`${result.stderr}${result.stdout}`.trim()}\n`;
          onProgress?.(`Refresh failed for ${account.name}\n`);
        }
      }
      rows.push({ name: account.name, snapshot: refresh ? refreshSnapshot : await findLatestLimitsForHome(account.home) });
    }
    const stdout = formatLimitTable(rows);
    return { exitCode, stdout, stderr };
  }

  return {
    exitCode: 1,
    stdout: HELP,
    stderr: `Unknown command: ${command}\n`,
  };
}
