import { spawn } from "node:child_process";

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunCodexOptions {
  input?: string;
  stdin?: "inherit" | "ignore";
  stdio?: "inherit" | "pipe";
  timeoutMs?: number;
}

export function buildCodexEnv(env: Record<string, string | undefined>, accountHome: string): NodeJS.ProcessEnv {
  return {
    ...env,
    CODEX_HOME: accountHome,
  };
}

export function shellExportCode(accountHome: string): string {
  const escaped = accountHome.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `export CODEX_HOME="${escaped}"\n`;
}

export async function runCodexProcess(
  accountHome: string,
  args: string[],
  env: Record<string, string | undefined>,
  options: RunCodexOptions = {},
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const inherited = options.stdio === "inherit";
    const child = spawn("codex", args, {
      env: buildCodexEnv(env, accountHome),
      stdio: inherited ? "inherit" : [options.input === undefined ? (options.stdin ?? "inherit") : "pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    const timer =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            child.kill("SIGTERM");
            finish({
              exitCode: 124,
              stdout,
              stderr: `${stderr}codex command timed out after ${options.timeoutMs}ms\n`,
            });
          }, options.timeoutMs)
        : undefined;

    if (!inherited) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }

    child.on("error", (error) => {
      finish({
        exitCode: 1,
        stdout,
        stderr: `${stderr}${error.message}\n`,
      });
    });

    child.on("close", (code) => {
      finish({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}
