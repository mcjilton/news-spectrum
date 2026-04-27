export type ModelTask =
  | "embed"
  | "classifyArticle"
  | "extractClaims"
  | "summarizeEvent"
  | "compareFraming"
  | "auditAnalysis";

export type GenerateTextInput = {
  task: Exclude<ModelTask, "embed">;
  prompt: string;
  sourceIds?: string[];
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  textVerbosity?: "low" | "medium" | "high";
};

export type GenerateJsonInput = GenerateTextInput & {
  schemaName: string;
};

export type EmbedTextInput = {
  task: "embed";
  input: string | string[];
};

export type ModelRunMetadata = {
  provider: string;
  model: string;
  task: ModelTask;
  promptVersion: string;
  sourceIds: string[];
  estimatedCostUsd: number;
  createdAt: string;
};

export type TextModelResult = {
  text: string;
  metadata: ModelRunMetadata;
};

export type JsonModelResult<T> = {
  json: T;
  metadata: ModelRunMetadata;
};

export type EmbeddingResult = {
  embeddings: number[][];
  metadata: ModelRunMetadata;
};

export type ModelProvider = {
  generateText(input: GenerateTextInput): Promise<TextModelResult>;
  generateJson<T>(input: GenerateJsonInput): Promise<JsonModelResult<T>>;
  embedText(input: EmbedTextInput): Promise<EmbeddingResult>;
};
