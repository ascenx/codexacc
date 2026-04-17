import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BEGIN_MARKER = "# >>> codexacc shell integration >>>";
const END_MARKER = "# <<< codexacc shell integration <<<";

export function shellHook(): string {
  return `${BEGIN_MARKER}
unalias codex 2>/dev/null || true
codex() {
  local _codexacc_home
  _codexacc_home="$(command codexacc current-home 2>/dev/null)"
  if [ -n "$_codexacc_home" ]; then
    CODEX_HOME="$_codexacc_home" command codex "$@"
  else
    command codex "$@"
  fi
}
${END_MARKER}
`;
}

async function readIfExists(filePath: string): Promise<string> {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    return "";
  }
  return readFile(filePath, "utf8");
}

export async function installShellHook(env: Record<string, string | undefined>): Promise<string> {
  const home = env.HOME;
  if (!home) throw new Error("HOME is not set");

  const zshrcPath = path.join(home, ".zshrc");
  const existing = await readIfExists(zshrcPath);
  const block = shellHook();
  const pattern = new RegExp(`${BEGIN_MARKER}[\\s\\S]*?${END_MARKER}\\n?`, "m");
  const next = pattern.test(existing) ? existing.replace(pattern, block) : `${existing}${existing.endsWith("\n") || !existing ? "" : "\n"}${block}`;

  await writeFile(zshrcPath, next);
  return zshrcPath;
}
