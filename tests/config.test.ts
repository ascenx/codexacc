import { describe, expect, it } from "vitest";
import { providerConfigToml } from "../src/config.js";

describe("providerConfigToml", () => {
  it("quotes provider table keys when account names contain dots", () => {
    expect(providerConfigToml({ name: "open.router", baseUrl: "https://example.com/v1", apiKey: "sk-test" })).toBe(`model_provider = "open.router"

[model_providers."open.router"]
name = "open.router"
base_url = "https://example.com/v1"
wire_api = "responses"
requires_openai_auth = false
env_key = "CODEXACC_OPEN_ROUTER_API_KEY"
`);
  });
});
