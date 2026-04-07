import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENV_PATH = join(process.cwd(), ".env");

type EnvConfig = {
  OPENROUTER_API_KEY: string;
  OLLAMA_HOST: string;
  LLAMACPP_HOST: string;
  MLX_HOST: string;
  LMSTUDIO_HOST: string;
  VLLM_HOST: string;
  MODEL_REQUEST_TIMEOUT_SECONDS: string;
  LLM_MODELS: string;
  LLM_MODELS_2: string;
};

const CONFIG_KEYS: (keyof EnvConfig)[] = [
  "OPENROUTER_API_KEY",
  "OLLAMA_HOST",
  "LLAMACPP_HOST",
  "MLX_HOST",
  "LMSTUDIO_HOST",
  "VLLM_HOST",
  "MODEL_REQUEST_TIMEOUT_SECONDS",
  "LLM_MODELS",
  "LLM_MODELS_2",
];

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

function buildEnvContent(config: Partial<EnvConfig>): string {
  const lines: string[] = [
    "# Hermes Agent Benchmark Configuration",
    "# Managed via the admin panel — edit here or in the UI.",
    "",
    "# API Keys",
    `OPENROUTER_API_KEY=${config.OPENROUTER_API_KEY ?? ""}`,
    "",
    "# Provider Hosts (without /v1 — added automatically)",
    `OLLAMA_HOST=${config.OLLAMA_HOST ?? ""}`,
    `LLAMACPP_HOST=${config.LLAMACPP_HOST ?? ""}`,
    `MLX_HOST=${config.MLX_HOST ?? ""}`,
    `LMSTUDIO_HOST=${config.LMSTUDIO_HOST ?? ""}`,
    `VLLM_HOST=${config.VLLM_HOST ?? ""}`,
    "",
    "# Timeout",
    `MODEL_REQUEST_TIMEOUT_SECONDS=${config.MODEL_REQUEST_TIMEOUT_SECONDS ?? "30"}`,
    "",
    "# Models (comma-separated provider:model entries)",
    `LLM_MODELS=${config.LLM_MODELS ?? ""}`,
    `LLM_MODELS_2=${config.LLM_MODELS_2 ?? ""}`,
    "",
  ];
  return lines.join("\n");
}

export async function GET() {
  try {
    const content = await readFile(ENV_PATH, "utf-8");
    const parsed = parseEnvFile(content);

    const config: Record<string, string> = {};
    for (const key of CONFIG_KEYS) {
      config[key] = parsed[key] ?? "";
    }
    // Mask the API key for display
    if (config.OPENROUTER_API_KEY && config.OPENROUTER_API_KEY.length > 8) {
      config.OPENROUTER_API_KEY_MASKED =
        config.OPENROUTER_API_KEY.slice(0, 4) + "..." + config.OPENROUTER_API_KEY.slice(-4);
    } else {
      config.OPENROUTER_API_KEY_MASKED = config.OPENROUTER_API_KEY ? "****" : "";
    }

    return NextResponse.json(config);
  } catch {
    return NextResponse.json(
      Object.fromEntries(CONFIG_KEYS.map((k) => [k, ""])),
      { status: 200 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<EnvConfig>;
    const content = buildEnvContent(body);
    await writeFile(ENV_PATH, content, "utf-8");

    // Update process.env so changes take effect without restart
    for (const key of CONFIG_KEYS) {
      const value = body[key];
      if (value !== undefined) {
        process.env[key] = value;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save config." },
      { status: 500 }
    );
  }
}
