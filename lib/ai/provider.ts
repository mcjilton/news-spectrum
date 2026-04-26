import "server-only";
import { getRuntimeModelProvider } from "./runtime-provider";
import type { ModelProvider } from "./types";

export function getModelProvider(): ModelProvider {
  return getRuntimeModelProvider();
}
