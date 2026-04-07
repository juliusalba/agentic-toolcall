export type ProviderName = "openrouter" | "ollama" | "llamacpp" | "mlx" | "lmstudio" | "vllm";

export type ModelMetadata = {
  contextWindow?: number;
  costPerMillionInput?: number;
  costPerMillionOutput?: number;
};

export type ModelConfig = {
  id: string;
  label: string;
  provider: ProviderName;
  model: string;
  baseUrl: string;
  apiKey?: string;
  metadata: ModelMetadata;
};

export type PublicModelConfig = Omit<ModelConfig, "apiKey">;
export type ModelConfigGroups = {
  primary: ModelConfig[];
  secondary: ModelConfig[];
  all: ModelConfig[];
};
export type PublicModelConfigGroups = {
  primary: PublicModelConfig[];
  secondary: PublicModelConfig[];
  all: PublicModelConfig[];
};

const PROVIDERS = new Set<ProviderName>(["openrouter", "ollama", "llamacpp", "mlx", "lmstudio", "vllm"]);

// Known context windows for common Hermes and tool-calling models.
// Used as fallback when MODEL_CONTEXT_WINDOWS env is not set.
const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  "hermes3:8b": 8192,
  "hermes3:70b": 8192,
  "hermes3:405b": 8192,
  "NousResearch/Hermes-3-Llama-3.1-8B": 131072,
  "NousResearch/Hermes-3-Llama-3.1-70B": 131072,
  "NousResearch/Hermes-3-Llama-3.1-405B": 131072,
  "NousResearch/Hermes-2-Pro-Llama-3-8B": 8192,
  "nousresearch/hermes-3-llama-3.1-405b": 131072,
  "nousresearch/hermes-3-llama-3.1-70b": 131072,
  "nousresearch/hermes-3-llama-3.1-8b": 131072,
  "openai/gpt-4.1": 1047576,
  "openai/gpt-4.1-mini": 1047576,
  "openai/gpt-4o": 128000,
  "anthropic/claude-sonnet-4": 200000,
  "anthropic/claude-opus-4": 200000,
  "google/gemini-2.5-pro": 1048576,
  "mistralai/mistral-small-3.2": 128000,
  "qwen/qwen-3-32b": 131072,
  "qwen/qwen-3-8b": 131072,
};

// Known costs per million tokens (input/output) for OpenRouter models.
const KNOWN_COSTS: Record<string, { input: number; output: number }> = {
  "nousresearch/hermes-3-llama-3.1-405b": { input: 5.0, output: 15.0 },
  "nousresearch/hermes-3-llama-3.1-70b": { input: 0.8, output: 0.8 },
  "nousresearch/hermes-3-llama-3.1-8b": { input: 0.06, output: 0.06 },
  "openai/gpt-4.1": { input: 2.0, output: 8.0 },
  "openai/gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "openai/gpt-4o": { input: 2.5, output: 10.0 },
  "anthropic/claude-sonnet-4": { input: 3.0, output: 15.0 },
  "anthropic/claude-opus-4": { input: 15.0, output: 75.0 },
  "google/gemini-2.5-pro": { input: 1.25, output: 10.0 },
};

function resolveModelMetadata(provider: ProviderName, model: string): ModelMetadata {
  const metadata: ModelMetadata = {};

  // Check known context windows
  const ctxKey = provider === "openrouter" ? model : `${model}`;
  for (const [pattern, ctx] of Object.entries(KNOWN_CONTEXT_WINDOWS)) {
    if (pattern.toLowerCase() === ctxKey.toLowerCase()) {
      metadata.contextWindow = ctx;
      break;
    }
  }

  // Check known costs (mostly relevant for cloud providers)
  if (provider === "openrouter") {
    const costKey = model.toLowerCase();
    for (const [pattern, cost] of Object.entries(KNOWN_COSTS)) {
      if (pattern.toLowerCase() === costKey) {
        metadata.costPerMillionInput = cost.input;
        metadata.costPerMillionOutput = cost.output;
        break;
      }
    }
  }

  // Parse MODEL_CONTEXT_WINDOWS env overrides: "model1:8192,model2:131072"
  const ctxOverrides = process.env.MODEL_CONTEXT_WINDOWS?.trim();
  if (ctxOverrides) {
    for (const entry of ctxOverrides.split(",")) {
      const [key, val] = entry.split(":").map(s => s.trim());
      if (key && val && model.toLowerCase().includes(key.toLowerCase())) {
        metadata.contextWindow = parseInt(val, 10);
      }
    }
  }

  return metadata;
}

function normalizeHostBaseUrl(host: string, envName: string): string {
  const trimmed = host.trim().replace(/\/+$/, "");

  if (!trimmed) {
    throw new Error(`${envName} is empty.`);
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`${envName} must start with http:// or https://.`);
  }

  const url = new URL(trimmed);
  const path = url.pathname.replace(/\/+$/, "");

  if (!path || path === "/") {
    url.pathname = "/v1";
    return url.toString().replace(/\/$/, "");
  }

  if (path.endsWith("/v1")) {
    url.pathname = path;
    return url.toString().replace(/\/$/, "");
  }

  if (path.endsWith("/api")) {
    url.pathname = `${path.slice(0, -4) || ""}/v1`;
    return url.toString().replace(/\/$/, "");
  }

  url.pathname = `${path}/v1`;
  return url.toString().replace(/\/$/, "");
}

function providerLabel(provider: ProviderName): string {
  switch (provider) {
    case "openrouter":
      return "OpenRouter";
    case "ollama":
      return "Ollama";
    case "llamacpp":
      return "llama.cpp";
    case "mlx":
      return "mlx_lm";
    case "lmstudio":
      return "LM Studio";
    case "vllm":
      return "vLLM";
  }
}

function buildProviderBaseUrl(provider: ProviderName, envName: string): string {
  switch (provider) {
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "ollama": {
      const host = process.env.OLLAMA_HOST?.trim();

      if (!host) {
        throw new Error(`OLLAMA_HOST is required when ${envName} includes an ollama model.`);
      }

      return normalizeHostBaseUrl(host, "OLLAMA_HOST");
    }
    case "llamacpp": {
      const host = process.env.LLAMACPP_HOST?.trim();

      if (!host) {
        throw new Error(`LLAMACPP_HOST is required when ${envName} includes a llamacpp model.`);
      }

      return normalizeHostBaseUrl(host, "LLAMACPP_HOST");
    }
    case "mlx": {
      const host = process.env.MLX_HOST?.trim();

      if (!host) {
        throw new Error(`MLX_HOST is required when ${envName} includes an mlx model.`);
      }

      return normalizeHostBaseUrl(host, "MLX_HOST");
    }
    case "lmstudio": {
      const host = process.env.LMSTUDIO_HOST?.trim();

      if (!host) {
        throw new Error(`LMSTUDIO_HOST is required when ${envName} includes an lmstudio model.`);
      }

      return normalizeHostBaseUrl(host, "LMSTUDIO_HOST");
    }
    case "vllm": {
      const host = process.env.VLLM_HOST?.trim();

      if (!host) {
        throw new Error(`VLLM_HOST is required when ${envName} includes a vllm model.`);
      }

      return normalizeHostBaseUrl(host, "VLLM_HOST");
    }
  }
}

function buildProviderApiKey(provider: ProviderName, envName: string): string | undefined {
  if (provider !== "openrouter") {
    return undefined;
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(`OPENROUTER_API_KEY is required when ${envName} includes an openrouter model.`);
  }

  return apiKey;
}

function parseProvider(rawProvider: string, index: number, envName: string): ProviderName {
  const normalized = rawProvider.trim().toLowerCase();

  if (!PROVIDERS.has(normalized as ProviderName)) {
    throw new Error(
      `${envName} entry ${index + 1} has unsupported provider "${rawProvider}". Use openrouter, ollama, llamacpp, mlx, lmstudio, or vllm.`
    );
  }

  return normalized as ProviderName;
}

function parseModelEntry(entry: string, index: number, envName: string): ModelConfig {
  const trimmed = entry.trim();

  if (!trimmed) {
    throw new Error(`${envName} entry ${index + 1} is empty.`);
  }

  const separatorIndex = trimmed.indexOf(":");

  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    throw new Error(
      `${envName} entry ${index + 1} must use the format provider:model, for example openrouter:openai/gpt-4.1.`
    );
  }

  const provider = parseProvider(trimmed.slice(0, separatorIndex), index, envName);
  const model = trimmed.slice(separatorIndex + 1).trim();

  if (!model) {
    throw new Error(`${envName} entry ${index + 1} is missing the model name.`);
  }

  return {
    id: `${provider}:${model}`,
    label: `${model} via ${providerLabel(provider)}`,
    provider,
    model,
    baseUrl: buildProviderBaseUrl(provider, envName),
    apiKey: buildProviderApiKey(provider, envName),
    metadata: resolveModelMetadata(provider, model)
  };
}

function parseModelConfigList(envName: "LLM_MODELS" | "LLM_MODELS_2"): ModelConfig[] {
  const raw = process.env[envName]?.trim() ?? "";

  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => parseModelEntry(entry, index, envName));
}

function assertUniqueModelIds(models: ModelConfig[]): void {
  const seen = new Set<string>();

  for (const model of models) {
    if (seen.has(model.id)) {
      throw new Error(
        `Duplicate model "${model.id}" found across LLM_MODELS and LLM_MODELS_2. Each configured provider:model must be unique.`
      );
    }

    seen.add(model.id);
  }
}

export function getModelConfigGroups(): ModelConfigGroups {
  const primary = parseModelConfigList("LLM_MODELS");
  const secondary = parseModelConfigList("LLM_MODELS_2");
  const all = [...primary, ...secondary];

  assertUniqueModelIds(all);

  return {
    primary,
    secondary,
    all
  };
}

export function getModelConfigs(): ModelConfig[] {
  return getModelConfigGroups().all;
}

export function getPublicModelConfigGroups(): PublicModelConfigGroups {
  const { primary, secondary, all } = getModelConfigGroups();

  return {
    primary: primary.map(({ apiKey: _apiKey, ...model }) => model),
    secondary: secondary.map(({ apiKey: _apiKey, ...model }) => model),
    all: all.map(({ apiKey: _apiKey, ...model }) => model)
  };
}

export function getPublicModelConfigs(): PublicModelConfig[] {
  return getPublicModelConfigGroups().all;
}
