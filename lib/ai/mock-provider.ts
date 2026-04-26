import { serverConfig } from "@/lib/config";
import type {
  EmbedTextInput,
  EmbeddingResult,
  GenerateJsonInput,
  GenerateTextInput,
  JsonModelResult,
  ModelRunMetadata,
  ModelTask,
  TextModelResult,
} from "@/lib/ai/types";

function metadata(task: ModelTask, sourceIds: string[] = []): ModelRunMetadata {
  return {
    provider: "mock",
    model: task === "embed" ? serverConfig.modelEmbeddings : serverConfig.modelSummary,
    task,
    promptVersion: "mock-v1",
    sourceIds,
    estimatedCostUsd: 0,
    createdAt: new Date().toISOString(),
  };
}

export const mockProvider = {
  async generateText(input: GenerateTextInput): Promise<TextModelResult> {
    return {
      text: `Mock ${input.task} output. Live model calls are disabled in this environment.`,
      metadata: metadata(input.task, input.sourceIds),
    };
  },

  async generateJson<T>(input: GenerateJsonInput): Promise<JsonModelResult<T>> {
    return {
      json: {
        schemaName: input.schemaName,
        note: "Mock JSON output. Live model calls are disabled in this environment.",
      } as T,
      metadata: metadata(input.task, input.sourceIds),
    };
  },

  async embedText(input: EmbedTextInput): Promise<EmbeddingResult> {
    const values = Array.isArray(input.input) ? input.input : [input.input];

    return {
      embeddings: values.map(() => [0, 0, 0]),
      metadata: metadata("embed"),
    };
  },
};
