import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ThirdPartyProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
}

export interface ProviderRuntimeConfig {
  providerName: string;
  env: Record<string, string>;
}

interface ProviderSecrets {
  apiKeys?: Record<string, string>;
}

const SECRETS_FILE = "codexacc-secrets.json";

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlKey(value: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(value)) return value;
  return tomlString(value);
}

function parseTomlString(value: string): string | null {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function providerEnvKey(name: string): string {
  const normalized = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `CODEXACC_${normalized || "PROVIDER"}_API_KEY`;
}

export function providerConfigToml(config: ThirdPartyProviderConfig): string {
  const envKey = providerEnvKey(config.name);
  return `model_provider = ${tomlString(config.name)}

[model_providers.${tomlKey(config.name)}]
name = ${tomlString(config.name)}
base_url = ${tomlString(config.baseUrl)}
wire_api = "responses"
requires_openai_auth = false
env_key = ${tomlString(envKey)}
`;
}

export async function writeProviderConfig(accountHome: string, config: ThirdPartyProviderConfig): Promise<void> {
  const configPath = path.join(accountHome, "config.toml");
  const secretsPath = path.join(accountHome, SECRETS_FILE);
  const envKey = providerEnvKey(config.name);
  const secrets: ProviderSecrets = { apiKeys: { [envKey]: config.apiKey } };

  await writeFile(configPath, providerConfigToml(config), { mode: 0o600 });
  await chmod(configPath, 0o600).catch(() => undefined);
  await writeFile(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  await chmod(secretsPath, 0o600).catch(() => undefined);
}

function parseProviderRuntimeConfig(configToml: string, secrets: ProviderSecrets | null): ProviderRuntimeConfig | null {
  const modelProviderMatch = configToml.match(/^model_provider\s*=\s*(".*")\s*$/m);
  const providerTableMatches = [...configToml.matchAll(/^\[model_providers\.((?:"(?:\\.|[^"\\])*")|[A-Za-z0-9_-]+)\]\s*$/gm)];
  const providerName = modelProviderMatch ? parseTomlString(modelProviderMatch[1] ?? "") : parseProviderTableKey(providerTableMatches[0]?.[1]);
  if (!providerName) return null;

  const providerTable = providerTableMatches.find((match) => parseProviderTableKey(match[1]) === providerName) ?? providerTableMatches[0];
  if (!providerTable || providerTable.index === undefined) return null;

  const nextTableIndex = configToml.indexOf("\n[", providerTable.index + providerTable[0].length);
  const tableBody = configToml.slice(providerTable.index + providerTable[0].length, nextTableIndex === -1 ? undefined : nextTableIndex);
  const envKeyMatch = tableBody.match(/^env_key\s*=\s*(".*")\s*$/m);
  const envKey = envKeyMatch ? parseTomlString(envKeyMatch[1] ?? "") : null;
  if (!envKey) return null;

  const secret = secrets?.apiKeys?.[envKey] ?? (looksLikeApiKey(envKey) ? envKey : null);
  if (!secret) return null;

  return { providerName, env: { [envKey]: secret } };
}

function parseProviderTableKey(value: string | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('"')) return parseTomlString(value);
  return value;
}

function looksLikeApiKey(value: string): boolean {
  return /^sk-[A-Za-z0-9_-]+/.test(value);
}

export async function readProviderRuntimeConfig(accountHome: string): Promise<ProviderRuntimeConfig | null> {
  const configPath = path.join(accountHome, "config.toml");
  let configToml: string;
  try {
    configToml = await readFile(configPath, "utf8");
  } catch {
    return null;
  }

  let secrets: ProviderSecrets | null = null;
  try {
    secrets = JSON.parse(await readFile(path.join(accountHome, SECRETS_FILE), "utf8")) as ProviderSecrets;
  } catch {
    secrets = null;
  }

  return parseProviderRuntimeConfig(configToml, secrets);
}
