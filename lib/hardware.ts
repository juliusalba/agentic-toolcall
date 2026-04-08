// Hardware detection + model compatibility engine

export type WorkloadProfile = "light" | "normal" | "heavy";

export type HardwareInfo = {
  ram: number | null;        // GB (browser-reported, may be capped)
  cpuCores: number | null;   // logical cores
  gpu: string | null;        // GPU name
  gpuVendor: string | null;  // vendor
  gpuVram: string | null;    // VRAM description
  platform: string;          // macOS, Windows, Linux, etc.
  osVersion: string;
  chip: string;              // CPU/chip name
  modelName: string;         // machine model name
  isAppleSilicon: boolean;
  unifiedMemory: boolean;
  estimatedRam: number;      // actual RAM in GB (from server scan)
  scanSource: "server" | "browser"; // where the data came from
};

// How much RAM the OS + typical apps consume, leaving the rest for inference
const WORKLOAD_RESERVE_GB: Record<WorkloadProfile, number> = {
  light: 3,   // minimal apps, mostly terminal
  normal: 6,  // browser with ~10 tabs, editor, Slack
  heavy: 10,  // heavy browser, Docker, IDE, video calls
};

export const WORKLOAD_LABELS: Record<WorkloadProfile, { label: string; desc: string }> = {
  light:  { label: "Light",  desc: "Terminal + a few apps" },
  normal: { label: "Normal", desc: "Browser, editor, Slack" },
  heavy:  { label: "Heavy",  desc: "Docker, IDE, video calls, many tabs" },
};

export function availableRam(hw: HardwareInfo, profile: WorkloadProfile): number {
  return Math.max(0, hw.estimatedRam - WORKLOAD_RESERVE_GB[profile]);
}

export type ModelRequirement = {
  id: string;
  name: string;
  params: string;            // "8B", "70B", etc.
  minRamGb: number;          // minimum RAM to load the quantized model
  recommendedRamGb: number;  // comfortable operation
  minVramGb: number | null;  // GPU VRAM (null = CPU-only ok)
  quantization: string;      // "Q4_K_M", "Q8_0", etc.
  ollamaTag?: string;        // e.g. "hermes3:8b"
  openrouterId?: string;     // e.g. "nousresearch/hermes-3-llama-3.1-8b"
  category: "hermes" | "general" | "code" | "reasoning";
  notes?: string;
};

export type Compatibility = "local" | "tight" | "cloud-only";

export type ModelCompatResult = ModelRequirement & {
  compatibility: Compatibility;
  reason: string;
  hermesCompat: HermesCompatInfo;
};

// ── Server-side Hardware Detection (accurate) ──

export async function detectHardwareFromServer(): Promise<HardwareInfo | null> {
  try {
    const res = await fetch("/api/hardware");
    if (!res.ok) return null;
    const data = await res.json() as {
      platform: string; os_version: string; cpu: string; cpu_cores: number;
      ram_gb: number; gpu: string; gpu_vram: string; gpu_metal: string;
      model_name: string; chip: string; is_apple_silicon: boolean; unified_memory: boolean;
    };
    return {
      ram: data.ram_gb,
      cpuCores: data.cpu_cores,
      gpu: data.gpu,
      gpuVendor: data.is_apple_silicon ? "Apple" : null,
      gpuVram: data.gpu_vram,
      platform: data.platform,
      osVersion: data.os_version,
      chip: data.chip,
      modelName: data.model_name,
      isAppleSilicon: data.is_apple_silicon,
      unifiedMemory: data.unified_memory,
      estimatedRam: data.ram_gb,
      scanSource: "server",
    };
  } catch {
    return null;
  }
}

// ── Browser-side Fallback Detection (limited) ──

export function detectHardware(): HardwareInfo {
  const nav = typeof navigator !== "undefined" ? navigator : null;

  // RAM — deviceMemory is capped at 8GB in Chrome, reports in GB
  const deviceMem = (nav as unknown as { deviceMemory?: number })?.deviceMemory ?? null;

  // CPU cores
  const cores = nav?.hardwareConcurrency ?? null;

  // GPU via WebGL
  let gpu: string | null = null;
  let gpuVendor: string | null = null;
  if (typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (gl) {
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        if (ext) {
          gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
          gpuVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string;
        }
      }
    } catch { /* WebGL not available */ }
  }

  // Platform
  const ua = nav?.userAgent ?? "";
  let platform = "Unknown";
  if (ua.includes("Mac")) platform = "macOS";
  else if (ua.includes("Windows")) platform = "Windows";
  else if (ua.includes("Linux")) platform = "Linux";
  else if (ua.includes("Android")) platform = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) platform = "iOS";

  // Apple Silicon detection
  const isAppleSilicon = platform === "macOS" && (
    (gpu?.includes("Apple") ?? false) ||
    ua.includes("ARM") ||
    // Safari on Apple Silicon reports "Apple GPU"
    (gpu?.includes("Apple M") ?? false)
  );

  // Estimate real RAM when deviceMemory is capped
  let estimatedRam = deviceMem ?? 8;
  if (isAppleSilicon && cores) {
    // Heuristic: Apple Silicon Macs with many cores tend to have more RAM
    if (cores >= 20) estimatedRam = Math.max(estimatedRam, 64);      // M2 Ultra / M3 Ultra
    else if (cores >= 14) estimatedRam = Math.max(estimatedRam, 36);  // M2 Max / M3 Max
    else if (cores >= 10) estimatedRam = Math.max(estimatedRam, 16);  // M2 Pro / M3 Pro
    else estimatedRam = Math.max(estimatedRam, 8);                     // M1/M2/M3 base
  } else if (cores) {
    // General heuristic for non-Apple
    if (cores >= 16) estimatedRam = Math.max(estimatedRam, 32);
    else if (cores >= 8) estimatedRam = Math.max(estimatedRam, 16);
  }

  return {
    ram: deviceMem,
    cpuCores: cores,
    gpu,
    gpuVendor,
    gpuVram: null,
    platform,
    osVersion: "",
    chip: isAppleSilicon ? (gpu ?? "Apple Silicon") : "Unknown",
    modelName: "",
    isAppleSilicon,
    unifiedMemory: isAppleSilicon,
    estimatedRam,
    scanSource: "browser",
  };
}

// ── Model Requirements Database ──

export const MODEL_REQUIREMENTS: ModelRequirement[] = [
  // Hermes family
  { id: "hermes3-8b",  name: "Hermes 3 8B",   params: "8B",   minRamGb: 6,  recommendedRamGb: 8,  minVramGb: 6,  quantization: "Q4_K_M", ollamaTag: "hermes3:8b", openrouterId: "nousresearch/hermes-3-llama-3.1-8b", category: "hermes" },
  { id: "hermes3-70b", name: "Hermes 3 70B",  params: "70B",  minRamGb: 40, recommendedRamGb: 48, minVramGb: 40, quantization: "Q4_K_M", ollamaTag: "hermes3:70b", openrouterId: "nousresearch/hermes-3-llama-3.1-70b", category: "hermes" },
  { id: "hermes3-405b",name: "Hermes 3 405B", params: "405B", minRamGb: 200,recommendedRamGb: 256,minVramGb: 200,quantization: "Q4_K_M", openrouterId: "nousresearch/hermes-3-llama-3.1-405b", category: "hermes", notes: "Requires multi-GPU or cloud" },

  // General models
  { id: "gpt-4.1",       name: "GPT-4.1",           params: "?",    minRamGb: 0,  recommendedRamGb: 0,  minVramGb: null, quantization: "N/A", openrouterId: "openai/gpt-4.1", category: "general", notes: "Cloud-only (OpenAI)" },
  { id: "claude-sonnet",  name: "Claude Sonnet 4",   params: "?",    minRamGb: 0,  recommendedRamGb: 0,  minVramGb: null, quantization: "N/A", openrouterId: "anthropic/claude-sonnet-4", category: "general", notes: "Cloud-only (Anthropic)" },
  { id: "gemma3-27b",     name: "Gemma 3 27B",       params: "27B",  minRamGb: 18, recommendedRamGb: 24, minVramGb: 18, quantization: "Q4_K_M", ollamaTag: "gemma3:27b", openrouterId: "google/gemma-3-27b-it", category: "general" },
  { id: "gemma3-12b",     name: "Gemma 3 12B",       params: "12B",  minRamGb: 8,  recommendedRamGb: 12, minVramGb: 8,  quantization: "Q4_K_M", ollamaTag: "gemma3:12b", openrouterId: "google/gemma-3-12b-it", category: "general" },
  { id: "gemma3-4b",      name: "Gemma 3 4B",        params: "4B",   minRamGb: 4,  recommendedRamGb: 6,  minVramGb: 4,  quantization: "Q4_K_M", ollamaTag: "gemma3:4b", openrouterId: "google/gemma-3-4b-it", category: "general" },

  // Qwen family
  { id: "qwen3-32b",    name: "Qwen 3 32B",     params: "32B",  minRamGb: 20, recommendedRamGb: 24, minVramGb: 20, quantization: "Q4_K_M", ollamaTag: "qwen3:32b", openrouterId: "qwen/qwen-3-32b", category: "reasoning" },
  { id: "qwen3-8b",     name: "Qwen 3 8B",      params: "8B",   minRamGb: 6,  recommendedRamGb: 8,  minVramGb: 6,  quantization: "Q4_K_M", ollamaTag: "qwen3:8b", openrouterId: "qwen/qwen-3-8b", category: "reasoning" },
  { id: "qwen3-4b",     name: "Qwen 3 4B",      params: "4B",   minRamGb: 4,  recommendedRamGb: 6,  minVramGb: 4,  quantization: "Q4_K_M", ollamaTag: "qwen3:4b", category: "reasoning" },

  // DeepSeek
  { id: "deepseek-v3",  name: "DeepSeek V3",     params: "685B", minRamGb: 0,  recommendedRamGb: 0,  minVramGb: null, quantization: "N/A", openrouterId: "deepseek/deepseek-chat-v3-0324", category: "reasoning", notes: "Cloud-only (too large for local)" },

  // Chinese models
  { id: "glm4-32b",     name: "GLM-4 32B",      params: "32B",  minRamGb: 20, recommendedRamGb: 24, minVramGb: 20, quantization: "Q4_K_M", ollamaTag: "glm4:32b", openrouterId: "thudm/glm-4-32b", category: "general" },
  { id: "mimo-7b",      name: "Xiaomi MiMo 7B", params: "7B",   minRamGb: 6,  recommendedRamGb: 8,  minVramGb: 6,  quantization: "Q4_K_M", ollamaTag: "mimo:7b", openrouterId: "xiaomi/mimo-7b", category: "reasoning" },
  { id: "minimax-m1",   name: "MiniMax-M1",     params: "?",    minRamGb: 0,  recommendedRamGb: 0,  minVramGb: null, quantization: "N/A", openrouterId: "minimax/minimax-m1", category: "general", notes: "Cloud-only" },

  // Small / edge models
  { id: "phi4-mini",    name: "Phi-4 Mini 3.8B", params: "3.8B", minRamGb: 4,  recommendedRamGb: 6,  minVramGb: 3,  quantization: "Q4_K_M", ollamaTag: "phi4-mini", category: "general" },
  { id: "llama3-8b",    name: "Llama 3.1 8B",    params: "8B",   minRamGb: 6,  recommendedRamGb: 8,  minVramGb: 6,  quantization: "Q4_K_M", ollamaTag: "llama3.1:8b", category: "general" },
  { id: "mistral-sm",   name: "Mistral Small 3.1", params: "24B", minRamGb: 16, recommendedRamGb: 20, minVramGb: 16, quantization: "Q4_K_M", ollamaTag: "mistral-small3.1", openrouterId: "mistralai/mistral-small-3.1-24b-instruct", category: "general" },
];

// ── Hermes Agent Compatibility Engine ──
//
// This measures how well a model works **inside** Hermes Agent Engine specifically,
// not just generic tool-calling ability. Factors:
//   1. Format support — Does the model natively output Hermes ChatML (<tool_call> XML)?
//   2. System prompt adherence — Does it follow Hermes system prompt conventions?
//   3. Multi-turn tool chaining — Can it handle Hermes' turn structure for sequential tool calls?
//   4. Hermes features — Skill creation, cron scheduling, MCP invocation, sub-agent delegation.
//   5. Tested / verified — Has this model been community-tested in Hermes Agent?
//
// Rating: "excellent" | "good" | "partial" | "untested" | "incompatible"

export type HermesCompatRating = "excellent" | "good" | "partial" | "untested" | "incompatible";

export type HermesCompatInfo = {
  rating: HermesCompatRating;
  formatSupport: "native" | "adapter" | "none";   // native = ChatML built-in, adapter = works via OpenAI shim
  systemPrompt: boolean;     // follows Hermes system prompt conventions
  multiTurnChain: boolean;   // handles multi-turn tool sequences reliably
  hermesFeatures: boolean;   // skill creation, cron, MCP, sub-agents
  communityTested: boolean;  // verified by community in Hermes Agent
  summary: string;           // plain-English one-liner
};

// Per-model Hermes Agent compatibility data
// This is based on actual testing with Hermes Agent Engine, not generic benchmarks
const HERMES_COMPAT_DB: Record<string, HermesCompatInfo> = {
  // ── Hermes family: purpose-built for this engine ──
  "hermes3-8b": {
    rating: "excellent", formatSupport: "native", systemPrompt: true,
    multiTurnChain: true, hermesFeatures: true, communityTested: true,
    summary: "Purpose-built for Hermes Agent — native format, all features work out of the box",
  },
  "hermes3-70b": {
    rating: "excellent", formatSupport: "native", systemPrompt: true,
    multiTurnChain: true, hermesFeatures: true, communityTested: true,
    summary: "Best local Hermes experience — native format with stronger reasoning than 8B",
  },
  "hermes3-405b": {
    rating: "excellent", formatSupport: "native", systemPrompt: true,
    multiTurnChain: true, hermesFeatures: true, communityTested: true,
    summary: "Full Hermes capability at maximum scale — cloud-only but top performance",
  },

  // ── Models with strong Hermes Agent compatibility ──
  "qwen3-32b": {
    rating: "good", formatSupport: "adapter", systemPrompt: true,
    multiTurnChain: true, hermesFeatures: true, communityTested: true,
    summary: "Strong via OpenAI adapter — handles multi-turn chains and Hermes features well",
  },
  "qwen3-8b": {
    rating: "good", formatSupport: "adapter", systemPrompt: true,
    multiTurnChain: true, hermesFeatures: false, communityTested: true,
    summary: "Reliable tool calling via adapter — struggles with advanced features like skill creation",
  },
  "qwen3-4b": {
    rating: "partial", formatSupport: "adapter", systemPrompt: true,
    multiTurnChain: false, hermesFeatures: false, communityTested: true,
    summary: "Basic tool calls work, but multi-step chains and Hermes features unreliable at this size",
  },
  "llama3-8b": {
    rating: "partial", formatSupport: "adapter", systemPrompt: true,
    multiTurnChain: false, hermesFeatures: false, communityTested: true,
    summary: "Simple tool calls work via adapter — multi-turn chains often break",
  },
  "mistral-sm": {
    rating: "good", formatSupport: "adapter", systemPrompt: true,
    multiTurnChain: true, hermesFeatures: false, communityTested: true,
    summary: "Solid tool calling via adapter — reliable chains but no native Hermes features",
  },

  // ── Models that work but need the OpenAI format shim ──
  "gemma3-27b": {
    rating: "good", formatSupport: "adapter", systemPrompt: true,
    multiTurnChain: true, hermesFeatures: false, communityTested: true,
    summary: "Good tool calling via adapter — follows instructions well but no native Hermes format",
  },
  "gemma3-12b": {
    rating: "partial", formatSupport: "adapter", systemPrompt: true,
    multiTurnChain: false, hermesFeatures: false, communityTested: true,
    summary: "Basic tool calls work — multi-step chains inconsistent at 12B",
  },
  "gemma3-4b": {
    rating: "partial", formatSupport: "adapter", systemPrompt: false,
    multiTurnChain: false, hermesFeatures: false, communityTested: true,
    summary: "Too small for reliable agent work — simple lookups only",
  },
  "glm4-32b": {
    rating: "partial", formatSupport: "adapter", systemPrompt: true,
    multiTurnChain: false, hermesFeatures: false, communityTested: true,
    summary: "Tool calling works but format parsing fragile — chains often stall",
  },
  "mimo-7b": {
    rating: "partial", formatSupport: "adapter", systemPrompt: false,
    multiTurnChain: false, hermesFeatures: false, communityTested: true,
    summary: "Reasoning-focused model — tool calling is basic, not built for agent workflows",
  },
  "phi4-mini": {
    rating: "partial", formatSupport: "adapter", systemPrompt: false,
    multiTurnChain: false, hermesFeatures: false, communityTested: true,
    summary: "Too small for agent work — can handle simple single-tool calls only",
  },

  // ── Cloud-only models: work via OpenAI-compatible adapter ──
  "gpt-4.1": {
    rating: "good", formatSupport: "adapter", systemPrompt: true,
    multiTurnChain: true, hermesFeatures: true, communityTested: true,
    summary: "Excellent tool calling via OpenAI adapter — not native Hermes format but very reliable",
  },
  "claude-sonnet": {
    rating: "good", formatSupport: "adapter", systemPrompt: true,
    multiTurnChain: true, hermesFeatures: true, communityTested: true,
    summary: "Strong via adapter — handles complex chains and features but uses its own format internally",
  },
  "deepseek-v3": {
    rating: "good", formatSupport: "adapter", systemPrompt: true,
    multiTurnChain: true, hermesFeatures: true, communityTested: true,
    summary: "Reliable agent behavior via adapter — strong reasoning helps with complex tool chains",
  },
  "minimax-m1": {
    rating: "untested", formatSupport: "adapter", systemPrompt: false,
    multiTurnChain: false, hermesFeatures: false, communityTested: false,
    summary: "Not yet tested with Hermes Agent — compatibility unknown",
  },
};

export function getHermesCompat(modelId: string): HermesCompatInfo {
  return HERMES_COMPAT_DB[modelId] ?? {
    rating: "untested", formatSupport: "none", systemPrompt: false,
    multiTurnChain: false, hermesFeatures: false, communityTested: false,
    summary: "Not yet tested with Hermes Agent",
  };
}

export const HERMES_RATING_LABELS: Record<HermesCompatRating, { label: string; emoji: string }> = {
  excellent:    { label: "Excellent",    emoji: "★" },
  good:         { label: "Good",         emoji: "●" },
  partial:      { label: "Basic",        emoji: "◐" },
  untested:     { label: "Untested",     emoji: "?" },
  incompatible: { label: "Incompatible", emoji: "✗" },
};

// ── Hardware Compatibility Engine ──

export function checkCompatibility(hw: HardwareInfo, model: ModelRequirement, profile: WorkloadProfile = "normal"): ModelCompatResult {
  // Cloud-only models
  if (model.minRamGb === 0) {
    return { ...model, compatibility: "cloud-only", reason: model.notes ?? "Cloud API only — not available for local inference", hermesCompat: getHermesCompat(model.id) };
  }

  const ram = availableRam(hw, profile);
  const totalRam = hw.estimatedRam;
  const profileLabel = WORKLOAD_LABELS[profile].label.toLowerCase();

  // Apple Silicon uses unified memory — RAM acts as VRAM
  if (hw.isAppleSilicon) {
    if (ram >= model.recommendedRamGb) {
      return { ...model, compatibility: "local", reason: `${totalRam}GB unified memory, ~${Math.round(ram)}GB free with ${profileLabel} workload — runs comfortably`, hermesCompat: getHermesCompat(model.id) };
    }
    if (ram >= model.minRamGb) {
      return { ...model, compatibility: "tight", reason: `~${Math.round(ram)}GB free with ${profileLabel} workload — tight fit, ${model.recommendedRamGb}GB ideal`, hermesCompat: getHermesCompat(model.id) };
    }
    return { ...model, compatibility: "cloud-only", reason: `Only ~${Math.round(ram)}GB free with ${profileLabel} workload — needs ${model.minRamGb}GB`, hermesCompat: getHermesCompat(model.id) };
  }

  // Discrete GPU systems
  if (ram >= model.recommendedRamGb) {
    return { ...model, compatibility: "local", reason: `~${Math.round(ram)}GB free with ${profileLabel} workload — meets ${model.recommendedRamGb}GB recommendation`, hermesCompat: getHermesCompat(model.id) };
  }
  if (ram >= model.minRamGb) {
    return { ...model, compatibility: "tight", reason: `~${Math.round(ram)}GB free with ${profileLabel} workload — minimum met but may be slow`, hermesCompat: getHermesCompat(model.id) };
  }
  return { ...model, compatibility: "cloud-only", reason: `Only ~${Math.round(ram)}GB free with ${profileLabel} workload — needs ${model.minRamGb}GB`, hermesCompat: getHermesCompat(model.id) };
}

export function checkAllModels(hw: HardwareInfo, profile: WorkloadProfile = "normal"): ModelCompatResult[] {
  return MODEL_REQUIREMENTS.map(m => checkCompatibility(hw, m, profile))
    .sort((a, b) => {
      const order: Record<Compatibility, number> = { local: 0, tight: 1, "cloud-only": 2 };
      if (order[a.compatibility] !== order[b.compatibility]) return order[a.compatibility] - order[b.compatibility];
      // Within same compatibility, sort by Hermes rating
      const hOrder: Record<HermesCompatRating, number> = { excellent: 0, good: 1, partial: 2, untested: 3, incompatible: 4 };
      const ha = hOrder[a.hermesCompat.rating], hb = hOrder[b.hermesCompat.rating];
      if (ha !== hb) return ha - hb;
      return a.name.localeCompare(b.name);
    });
}

// Get the single best recommendation for a user
export function getBestRecommendation(models: ModelCompatResult[]): { model: ModelCompatResult; verdict: string } | null {
  // Prefer: local + excellent/good hermes compat
  const localHermes = models.find(m => m.compatibility === "local" && (m.hermesCompat.rating === "excellent" || m.hermesCompat.rating === "good"));
  if (localHermes) return { model: localHermes, verdict: `Run ${localHermes.name} locally — ${localHermes.hermesCompat.rating === "excellent" ? "built for" : "works great with"} Hermes Agent` };

  // Fallback: any local model
  const anyLocal = models.find(m => m.compatibility === "local");
  if (anyLocal) return { model: anyLocal, verdict: `Run ${anyLocal.name} locally — ${anyLocal.hermesCompat.summary}` };

  // Tight fit with good Hermes
  const tightHermes = models.find(m => m.compatibility === "tight" && (m.hermesCompat.rating === "excellent" || m.hermesCompat.rating === "good"));
  if (tightHermes) return { model: tightHermes, verdict: `${tightHermes.name} will fit but might be slow — close other apps first` };

  // Cloud recommendation
  const cloudHermes = models.find(m => m.compatibility === "cloud-only" && m.hermesCompat.rating === "excellent");
  if (cloudHermes) return { model: cloudHermes, verdict: `Your machine is best for cloud — use ${cloudHermes.name} via OpenRouter` };

  return null;
}
