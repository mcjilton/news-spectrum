import "server-only";
import { mockProvider } from "@/lib/ai/mock-provider";
import type { ModelProvider } from "@/lib/ai/types";
import { serverConfig } from "@/lib/config";

export function getModelProvider(): ModelProvider {
  if (serverConfig.modelProvider === "mock") {
    return mockProvider;
  }

  throw new Error(
    `Model provider "${serverConfig.modelProvider}" is configured but not implemented yet.`,
  );
}
