import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import type { AccountMetadata } from "./accounts.js";
import type { LimitChoiceSummary } from "./format.js";

export type AccountSelectionCommand = "use" | "run";

export interface AccountSelectionChoice extends LimitChoiceSummary {
  account: AccountMetadata;
}

export async function selectAccount(command: AccountSelectionCommand, choices: AccountSelectionChoice[]): Promise<string | null> {
  if (!stdin.isTTY || !stdout.isTTY) return null;

  const nameWidth = Math.max(...choices.map((choice) => choice.account.name.length));
  const fiveHourWidth = Math.max("5h".length, ...choices.map((choice) => choice.fiveHour.length));
  const weeklyWidth = Math.max("weekly".length, ...choices.map((choice) => choice.weekly.length));

  stdout.write(`Select account for codexacc ${command}:\n`);
  for (const [index, choice] of choices.entries()) {
    const plan = choice.plan === "unknown" ? "" : `  ${choice.plan}`;
    stdout.write(
      `  ${index + 1}) ${choice.account.name.padEnd(nameWidth, " ")}  5h ${choice.fiveHour.padEnd(fiveHourWidth, " ")}  weekly ${choice.weekly.padEnd(weeklyWidth, " ")}${plan}\n`,
    );
  }

  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await readline.question("Account number: ")).trim();
    const selected = Number(answer);
    if (!Number.isInteger(selected) || selected < 1 || selected > choices.length) return null;
    return choices[selected - 1]?.account.name ?? null;
  } finally {
    readline.close();
  }
}
