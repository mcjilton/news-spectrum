import OpenAI from "openai";

import { assertRuntimeSecret, runtimeConfig } from "../runtime-config.ts";
import type {
  EmbedTextInput,
  EmbeddingResult,
  GenerateJsonInput,
  GenerateTextInput,
  JsonModelResult,
  ModelProvider,
  ModelRunMetadata,
  ModelTask,
  TextModelResult,
} from "./types.ts";

const eventEnrichmentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "summary",
    "confidence",
    "divergence",
    "sharedFacts",
    "disputedOrVariable",
    "frames",
  ],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    divergence: { type: "integer", minimum: 0, maximum: 100 },
    sharedFacts: { type: "array", items: { type: "string" } },
    disputedOrVariable: { type: "array", items: { type: "string" } },
    frames: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["bucket", "label", "summary", "emphasis", "loadedLanguage", "sourceArticleIds"],
        properties: {
          bucket: { type: "string", enum: ["left", "center", "right"] },
          label: { type: "string" },
          summary: { type: "string" },
          emphasis: { type: "array", items: { type: "string" } },
          loadedLanguage: { type: "array", items: { type: "string" } },
          sourceArticleIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

function metadata(task: ModelTask, sourceIds: string[] = []): ModelRunMetadata {
  return {
    provider: "openai",
    model: task === "embed" ? runtimeConfig.modelEmbeddings : runtimeConfig.modelSummary,
    task,
    promptVersion: "openai-responses-v1",
    sourceIds,
    estimatedCostUsd: 0,
    createdAt: new Date().toISOString(),
  };
}

function client() {
  assertRuntimeSecret("OPENAI_API_KEY", runtimeConfig.openAiApiKey);
  return new OpenAI({
    apiKey: runtimeConfig.openAiApiKey,
  });
}

function schemaForName(schemaName: string) {
  if (schemaName === "event-enrichment-v1") {
    return eventEnrichmentSchema;
  }

  throw new Error(`No OpenAI JSON schema registered for ${schemaName}.`);
}

function assertOpenAiModelConfigured(task: ModelTask) {
  const model = task === "embed" ? runtimeConfig.modelEmbeddings : runtimeConfig.modelSummary;

  if (!model || model.startsWith("mock-")) {
    throw new Error(
      `${task} requires a real OpenAI model. Set MODEL_SUMMARY or MODEL_EMBEDDINGS before using MODEL_PROVIDER=openai.`,
    );
  }

  return model;
}

export const openAiProvider: ModelProvider = {
  async generateText(input: GenerateTextInput): Promise<TextModelResult> {
    const model = assertOpenAiModelConfigured(input.task);
    const response = await client().responses.create({
      model,
      input: input.prompt,
    });

    return {
      text: response.output_text,
      metadata: metadata(input.task, input.sourceIds),
    };
  },

  async generateJson<T>(input: GenerateJsonInput): Promise<JsonModelResult<T>> {
    const model = assertOpenAiModelConfigured(input.task);
    const response = await client().responses.create({
      model,
      input: input.prompt,
      text: {
        format: {
          type: "json_schema",
          name: input.schemaName,
          strict: true,
          schema: schemaForName(input.schemaName),
        },
      },
    });

    return {
      json: JSON.parse(response.output_text) as T,
      metadata: metadata(input.task, input.sourceIds),
    };
  },

  async embedText(_input: EmbedTextInput): Promise<EmbeddingResult> {
    throw new Error("OpenAI embeddings are not wired yet.");
  },
};
