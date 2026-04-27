import { runtimeConfig } from "../runtime-config.ts";
import type {
  EmbedTextInput,
  EmbeddingResult,
  GenerateJsonInput,
  GenerateTextInput,
  JsonModelResult,
  ModelRunMetadata,
  ModelTask,
  TextModelResult,
} from "./types.ts";

function metadata(task: ModelTask, sourceIds: string[] = []): ModelRunMetadata {
  return {
    provider: "mock",
    model: task === "embed" ? runtimeConfig.modelEmbeddings : runtimeConfig.modelSummary,
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
    if (input.schemaName === "cluster-merge-decision-v1") {
      return {
        json: {
          sameEvent: true,
          confidence: 90,
          reason: "Mock merge decision for validating the merge adjudication harness.",
          canonicalTitle: "Mock merged candidate event",
          mergeStrategy: "merge",
        } as T,
        metadata: metadata(input.task, input.sourceIds),
      };
    }

    if (input.schemaName === "event-enrichment-v1") {
      return {
        json: {
          title: "Mock enriched event title",
          summary:
            "Mock enrichment summary generated without a live model call. This validates the event enrichment write path.",
          confidence: 70,
          divergence: 40,
          sharedFacts: [
            "Multiple outlets have published coverage about the same candidate event.",
            "The candidate event has not been reviewed for publication.",
          ],
          disputedOrVariable: [
            "Mock output cannot assess real framing differences until a live provider is enabled.",
          ],
          frames: [
            {
              bucket: "left",
              label: "Mock left framing",
              summary: "Mock left-bucket framing summary.",
              emphasis: ["accountability", "impact"],
              loadedLanguage: ["questions", "concerns"],
              sourceArticleIds: input.sourceIds ?? [],
            },
            {
              bucket: "center",
              label: "Mock center framing",
              summary: "Mock center-bucket framing summary.",
              emphasis: ["timeline", "confirmed details"],
              loadedLanguage: ["reported", "officials"],
              sourceArticleIds: input.sourceIds ?? [],
            },
            {
              bucket: "right",
              label: "Mock right framing",
              summary: "Mock right-bucket framing summary.",
              emphasis: ["security", "response"],
              loadedLanguage: ["failure", "scrutiny"],
              sourceArticleIds: input.sourceIds ?? [],
            },
          ],
        } as T,
        metadata: metadata(input.task, input.sourceIds),
      };
    }

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
