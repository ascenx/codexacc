import { tmpdir } from "node:os";
import path from "node:path";
import { createAccount, listAccounts, readAccount, readCurrentAccount, removeAccount, setCurrentAccount, type AccountMetadata } from "./accounts.js";
import { readProviderRuntimeConfig, writeProviderConfig, type ProviderRuntimeConfig } from "./config.js";
import { runCodexProcess, type ProcessResult, type RunCodexOptions } from "./codex.js";
import { formatLimitChoice, formatLimitTable, type LimitTableRow } from "./format.js";
import { findLatestLimitsForHome, findLatestLimitsInJsonl, type LimitSnapshot } from "./limits.js";
import { getStoreRoot } from "./paths.js";
import { promptText, selectAccount, selectAddSetupMethod, type AccountSelectionChoice, type AccountSelectionCommand, type AddSetupMethod } from "./prompt.js";
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
  selectAddSetupMethod?: () => Promise<AddSetupMethod | null>;
  promptText?: (label: string) => Promise<string | null>;
}

const HELP = `codexacc <command>

Commands:
  add <name>            Create an account home; choose ChatGPT login or third-party API key setup
  remove <name>         Remove a managed account home
  rm <name>             Alias for remove
  run [name] [args...]  Run codex with the selected account
  run-current [args...] Run codex with the default account selected by use
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

function setupErrorResult(accountName: string, error: unknown): CliResult {
  const message = error instanceof Error ? error.message : String(error);
  return { exitCode: 1, stdout: "", stderr: `${message}\nRemoved incomplete account ${accountName}\n` };
}

function requiredInput(value: string | null, label: string): string {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function providerConfigArgs(provider: ProviderRuntimeConfig | null): string[] {
  return provider ? ["-c", `model_provider=${JSON.stringify(provider.providerName)}`] : [];
}

function providerEnv(env: CliEnv, provider: ProviderRuntimeConfig | null): CliEnv {
  return provider ? { ...env, ...provider.env } : env;
}

async function runAccount(
  runCodex: (accountHome: string, args: string[], env: CliEnv, options?: RunCodexOptions) => Promise<ProcessResult>,
  account: AccountMetadata,
  userCodexArgs: string[],
  env: CliEnv,
): Promise<CliResult> {
  const runtimeConfig = await readProviderRuntimeConfig(account.home);
  const codexArgs = [...providerConfigArgs(runtimeConfig), ...userCodexArgs];
  return await runCodex(account.home, codexArgs, providerEnv(env, runtimeConfig), userCodexArgs.length === 0 ? { stdio: "inherit" } : undefined);
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
  const chooseAddSetupMethod = deps.selectAddSetupMethod ?? selectAddSetupMethod;
  const askText = deps.promptText ?? promptText;
  const command = args[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    return { exitCode: 0, stdout: HELP, stderr: "" };
  }

  if (command === "add") {
    const name = args[1];
    try {
      const storeRoot = getStoreRoot(env);
      const account = await createAccount(storeRoot, name);

      try {
        const setupMethod = await chooseAddSetupMethod();
        if (!setupMethod) throw new Error("Setup method is required");

        if (setupMethod === "chatgpt") {
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
        }

        const baseUrl = requiredInput(await askText("Server URL"), "Server URL");
        const apiKey = requiredInput(await askText("API key"), "API key");
        await writeProviderConfig(account.home, { name: account.name, baseUrl, apiKey });
        return {
          exitCode: 0,
          stdout: `Created account ${account.name} at ${account.home}\nConfigured third-party API provider ${account.name}\n`,
          stderr: "",
        };
      } catch (error) {
        await removeAccount(storeRoot, account.name);
        return setupErrorResult(account.name, error);
      }
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
      return await runAccount(runCodex, account, args.slice(2), env);
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  }

  if (command === "run-current") {
    try {
      const storeRoot = getStoreRoot(env);
      const current = await readCurrentAccount(storeRoot);
      if (!current) return errorResult("No current account selected");
      const account = await readAccount(storeRoot, current.name);
      return await runAccount(runCodex, account, args.slice(1), env);
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
      const runtimeConfig = await readProviderRuntimeConfig(account.home);
      const active = env.CODEX_HOME === account.home || current?.home === account.home ? "*" : "";
      if (runtimeConfig) {
        lines.push(`${account.name}\t${active}\tAPI key provider (${runtimeConfig.providerName})\t${account.home}`);
        continue;
      }

      const status = await runCodex(account.home, ["login", "status"], env);
      const loginStatus = status.exitCode === 0 ? `${status.stdout}${status.stderr}`.trim() : "Not logged in";
      lines.push(`${account.name}\t${active}\t${loginStatus}\t${account.home}`);
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
        const runtimeConfig = await readProviderRuntimeConfig(account.home);
        onProgress?.(`Refreshing ${account.name}...\n`);
        const refreshStartedAt = new Date().toISOString();
        const outputPath = path.join(tmpdir(), `codexacc-limit-${account.name}-${process.pid}-${Date.now()}.txt`);
        let result: ProcessResult;
        try {
          result = await withTimeout(
            runCodex(
              account.home,
              [...providerConfigArgs(runtimeConfig), "exec", "--skip-git-repo-check", "-o", outputPath, LIMIT_REFRESH_PROMPT],
              providerEnv(env, runtimeConfig),
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
