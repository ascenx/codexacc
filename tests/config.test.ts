import { describe, expect, it } from "vitest";
import { providerConfigToml } from "../src/config.js";

describe("providerConfigToml", () => {
  it("quotes provider table keys when account names contain dots", () => {
    expect(providerConfigToml({ name: "open.router", baseUrl: "https://example.com/v1", apiKey: "sk-test" })).toBe(`[model_providers."open.router"]
name = "open.router"
base_url = "https://example.com/v1"
wire_api = "openai"
requires_openai_auth = false
env_key = "sk-test"
`);
  });
});
