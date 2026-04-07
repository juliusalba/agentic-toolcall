import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENV_PATH = join(process.cwd(), ".env");
const SECRET_KEYS = new Set(["OPENROUTER_API_KEY"]);

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

function isLocalRequest(request: Request): boolean {
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
}

function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "..." + value.slice(-4);
}

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    result[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }
  return result;
}

function buildEnvContent(config: Partial<EnvConfig>): string {
  return [
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
  ].join("\n");
}

export async function GET(request: Request) {
  if (!isLocalRequest(request)) {
    return NextResponse.json({ error: "Config API is only available on localhost." }, { status: 403 });
  }

  try {
    const content = await readFile(ENV_PATH, "utf-8");
    const parsed = parseEnvFile(content);

    // Never send raw secrets to the client — mask them
    const config: Record<string, string> = {};
    for (const key of CONFIG_KEYS) {
      const val = parsed[key] ?? "";
      config[key] = SECRET_KEYS.has(key) ? maskSecret(val) : val;
    }
    // Send a flag indicating whether the key is set (so UI knows)
    config._HAS_OPENROUTER_KEY = parsed.OPENROUTER_API_KEY ? "true" : "false";

    return NextResponse.json(config);
  } catch {
    return NextResponse.json(
      Object.fromEntries([...CONFIG_KEYS.map((k) => [k, ""]), ["_HAS_OPENROUTER_KEY", "false"]]),
      { status: 200 }
    );
  }
}

export async function POST(request: Request) {
  if (!isLocalRequest(request)) {
    return NextResponse.json({ error: "Config API is only available on localhost." }, { status: 403 });
  }

  try {
    const body = (await request.json()) as Partial<EnvConfig>;

    // If the API key field is a masked value, preserve the existing key
    if (body.OPENROUTER_API_KEY && (body.OPENROUTER_API_KEY.includes("...") || body.OPENROUTER_API_KEY === "****")) {
      try {
        const existing = parseEnvFile(await readFile(ENV_PATH, "utf-8"));
        body.OPENROUTER_API_KEY = existing.OPENROUTER_API_KEY ?? "";
      } catch { /* file doesn't exist yet */ }
    }

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
