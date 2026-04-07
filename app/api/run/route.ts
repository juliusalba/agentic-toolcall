import { SCENARIOS } from "@/lib/benchmark";
import { ENTERPRISE_SCENARIOS } from "@/lib/benchmark-enterprise";
import { MEMORY_SCENARIOS } from "@/lib/benchmark-memory";
import { getModelConfigs } from "@/lib/models";
import { runBenchmark, type RunEvent } from "@/lib/orchestrator";
import type { GenerationParams } from "@/lib/llm-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toSseChunk(event: RunEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedIds = searchParams.get("models")?.split(",").filter(Boolean) ?? [];
  const requestedScenarioIds = searchParams.get("scenarios")?.split(",").filter(Boolean) ?? [];

  const params: GenerationParams = {};
  const temperature = searchParams.get("temperature");
  if (temperature !== null) params.temperature = parseFloat(temperature);
  const topP = searchParams.get("top_p");
  if (topP !== null) params.top_p = parseFloat(topP);
  const topK = searchParams.get("top_k");
  if (topK !== null) params.top_k = parseInt(topK, 10);
  const minP = searchParams.get("min_p");
  if (minP !== null) params.min_p = parseFloat(minP);
  const repetitionPenalty = searchParams.get("repetition_penalty");
  if (repetitionPenalty !== null) params.repetition_penalty = parseFloat(repetitionPenalty);
  const toolsFormat = searchParams.get("tools_format");
  if (toolsFormat === "lfm") params.tools_format = "lfm";
  else if (toolsFormat === "hermes") params.tools_format = "hermes";

  const suiteParam = searchParams.get("suite") ?? "general";
  const activeScenarios = suiteParam === "business" ? ENTERPRISE_SCENARIOS : suiteParam === "memory" ? MEMORY_SCENARIOS : SCENARIOS;

  let models = [] as ReturnType<typeof getModelConfigs>;
  let configError: string | null = null;

  try {
    const allModels = getModelConfigs();
    models = requestedIds.length > 0 ? allModels.filter((model) => requestedIds.includes(model.id)) : allModels;
  } catch (error) {
    configError = error instanceof Error ? error.message : "Failed to read LLM_MODELS or LLM_MODELS_2.";
  }

  // Use the request signal to detect client disconnection
  const abortSignal = request.signal;
  let cancelled = false;
  abortSignal.addEventListener("abort", () => { cancelled = true; });

  const stream = new ReadableStream({
    async start(controller) {
      const emit = async (event: RunEvent) => {
        if (cancelled) return;
        try {
          controller.enqueue(toSseChunk(event));
        } catch {
          cancelled = true; // stream closed
        }
      };

      if (configError) {
        await emit({ type: "run_error", message: configError });
        controller.close();
        return;
      }

      if (models.length === 0) {
        await emit({ type: "run_error", message: "No models configured. Add entries in Configure → Models." });
        controller.close();
        return;
      }

      try {
        await runBenchmark(models, emit, requestedScenarioIds, params, activeScenarios);
      } catch (error) {
        if (!cancelled) {
          await emit({ type: "run_error", message: error instanceof Error ? error.message : "Unknown benchmark error." });
        }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Scenario-Count": String(activeScenarios.length)
    }
  });
}
