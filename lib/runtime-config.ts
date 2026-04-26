export type DataMode = "seed" | "imported" | "live";
export type ModelProviderName = "mock" | "openai" | "ollama";

function env(name: string, fallback = "") {
  return process.env[name] ?? fallback;
}

function intEnv(name: string, fallback: number) {
  const value = Number.parseInt(env(name), 10);
  return Number.isFinite(value) ? value : fallback;
}

function floatEnv(name: string, fallback: number) {
  const value = Number.parseFloat(env(name));
  return Number.isFinite(value) ? value : fallback;
}

function boolEnv(name: string, fallback: boolean) {
  const value = env(name);

  if (!value) {
    return fallback;
  }

  return value.toLowerCase() === "true";
}

function enumEnv<T extends string>(name: string, allowed: readonly T[], fallback: T) {
  const value = env(name);
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export const runtimeConfig = {
  dataMode: enumEnv<DataMode>("DATA_MODE", ["seed", "imported", "live"], "seed"),
  appUrl: env("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
  databaseUrl: env("DATABASE_URL"),
  supabaseUrl: env("SUPABASE_URL"),
  supabaseAnonKey: env("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY"),
  openAiApiKey: env("OPENAI_API_KEY"),
  ollamaBaseUrl: env("OLLAMA_BASE_URL", "http://localhost:11434"),
  modelProvider: enumEnv<ModelProviderName>(
    "MODEL_PROVIDER",
    ["mock", "openai", "ollama"],
    "mock",
  ),
  modelSummary: env("MODEL_SUMMARY", "mock-summary"),
  modelExtraction: env("MODEL_EXTRACTION", "mock-extraction"),
  modelEmbeddings: env("MODEL_EMBEDDINGS", "mock-embeddings"),
  ingestionJobToken: env("INGESTION_JOB_TOKEN"),
  analysisJobToken: env("ANALYSIS_JOB_TOKEN"),
  enableJobEndpoints: boolEnv("ENABLE_JOB_ENDPOINTS", false),
  disableLiveAnalysis: boolEnv("DISABLE_LIVE_ANALYSIS", true),
  maxEventsPerRun: intEnv("MAX_EVENTS_PER_RUN", 5),
  maxArticlesPerEvent: intEnv("MAX_ARTICLES_PER_EVENT", 40),
  maxLlmCallsPerRun: intEnv("MAX_LLM_CALLS_PER_RUN", 25),
  maxLlmEstimatedCostUsdPerRun: floatEnv("MAX_LLM_ESTIMATED_COST_USD_PER_RUN", 2),
} as const;

export function assertRuntimeSecret(name: string, value: string) {
  if (!value) {
    throw new Error(`Missing required server secret: ${name}`);
  }
}
