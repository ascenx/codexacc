import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ThirdPartyProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlKey(value: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(value)) return value;
  return tomlString(value);
}

export function providerConfigToml(config: ThirdPartyProviderConfig): string {
  return `[model_providers.${tomlKey(config.name)}]
name = ${tomlString(config.name)}
base_url = ${tomlString(config.baseUrl)}
wire_api = "responses"
requires_openai_auth = false
env_key = ${tomlString(config.apiKey)}
`;
}

export async function writeProviderConfig(accountHome: string, config: ThirdPartyProviderConfig): Promise<void> {
  const configPath = path.join(accountHome, "config.toml");
  await writeFile(configPath, providerConfigToml(config), { mode: 0o600 });
  await chmod(configPath, 0o600).catch(() => undefined);
}
