import { mockProvider } from "./mock-provider.ts";
import { openAiProvider } from "./openai-provider.ts";
import type { ModelProvider } from "./types.ts";
import { runtimeConfig } from "../runtime-config.ts";

export function getRuntimeModelProvider(): ModelProvider {
  if (runtimeConfig.modelProvider === "mock") {
    return mockProvider;
  }

  if (runtimeConfig.modelProvider === "openai") {
    return openAiProvider;
  }

  throw new Error(
    `Model provider "${runtimeConfig.modelProvider}" is configured but not implemented yet.`,
  );
}
