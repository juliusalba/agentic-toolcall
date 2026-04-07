// Hardware detection + model compatibility engine (client-side only)

export type HardwareInfo = {
  ram: number | null;        // GB (from navigator.deviceMemory — capped at 8 on some browsers)
  cpuCores: number | null;   // logical cores
  gpu: string | null;        // renderer string from WebGL
  gpuVendor: string | null;  // vendor string
  platform: string;          // macOS, Windows, Linux, etc.
  userAgent: string;
  isAppleSilicon: boolean;
  estimatedRam: number;      // best guess in GB (fills in when deviceMemory is capped)
};

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
};

// ── Hardware Detection ──

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
    platform,
    userAgent: ua,
    isAppleSilicon,
    estimatedRam,
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

// ── Compatibility Engine ──

export function checkCompatibility(hw: HardwareInfo, model: ModelRequirement): ModelCompatResult {
  // Cloud-only models
  if (model.minRamGb === 0) {
    return { ...model, compatibility: "cloud-only", reason: model.notes ?? "Cloud API only — not available for local inference" };
  }

  const ram = hw.estimatedRam;

  // Apple Silicon uses unified memory — RAM acts as VRAM
  if (hw.isAppleSilicon) {
    if (ram >= model.recommendedRamGb) {
      return { ...model, compatibility: "local", reason: `Apple Silicon with ${ram}GB unified memory — runs comfortably` };
    }
    if (ram >= model.minRamGb) {
      return { ...model, compatibility: "tight", reason: `Fits in ${ram}GB but may be slow — ${model.recommendedRamGb}GB recommended` };
    }
    return { ...model, compatibility: "cloud-only", reason: `Needs ${model.minRamGb}GB minimum — your Mac has ~${ram}GB` };
  }

  // Discrete GPU systems
  if (ram >= model.recommendedRamGb) {
    return { ...model, compatibility: "local", reason: `${ram}GB RAM available — meets ${model.recommendedRamGb}GB recommendation` };
  }
  if (ram >= model.minRamGb) {
    return { ...model, compatibility: "tight", reason: `${ram}GB available, minimum ${model.minRamGb}GB met — may run slowly` };
  }
  return { ...model, compatibility: "cloud-only", reason: `Needs ${model.minRamGb}GB minimum — ~${ram}GB detected` };
}

export function checkAllModels(hw: HardwareInfo): ModelCompatResult[] {
  return MODEL_REQUIREMENTS.map(m => checkCompatibility(hw, m))
    .sort((a, b) => {
      const order: Record<Compatibility, number> = { local: 0, tight: 1, "cloud-only": 2 };
      if (order[a.compatibility] !== order[b.compatibility]) return order[a.compatibility] - order[b.compatibility];
      return a.name.localeCompare(b.name);
    });
}
