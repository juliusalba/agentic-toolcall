# Hermes Agent Benchmark

A visual benchmark for testing and scoring LLM models on tool-calling capabilities, designed specifically for evaluating which models work best with [Hermes Agent](https://github.com/NousResearch) (NousResearch's tool-calling model family).

Built on top of [ToolCall-15](https://github.com/stevibe/toolcall-15) — enhanced with Hermes-native tool format support, latency tracking, cost estimation, and context window awareness.

## What It Measures

The benchmark runs 15 fixed scenarios across 5 categories and scores each model on multiple dimensions:

### Tool-Call Accuracy (Primary Score)

- **Tool Selection** — Can it pick the right tool?
- **Parameter Precision** — Does it pass the right arguments?
- **Multi-Step Chains** — Can it thread data across steps?
- **Restraint & Refusal** — Does it know when NOT to act?
- **Error Recovery** — What happens when things go wrong?

Each scenario is scored as `2` (pass), `1` (partial), or `0` (fail). Final score is the average of 5 category percentages.

### Extended Metrics

- **Speed & Latency** — Average and total response time per model across all scenarios
- **Context Window** — Known context sizes for common models, with env overrides
- **Cost Estimation** — Estimated cost per benchmark run based on known provider pricing
- **Avg Turns** — How many conversation turns the model needs to complete each scenario

## Hermes Tool-Calling Format

This benchmark includes first-class support for the Hermes tool-calling format used by NousResearch models (Hermes 2 Pro, Hermes 3). Select `hermes` in the Tools Format dropdown to:

- Inject tool definitions into the system prompt inside `<tools></tools>` XML tags
- Parse `<tool_call>{"name": "...", "arguments": {...}}</tool_call>` responses
- Format tool results with `<tool_response></tool_response>` tags
- Handle multi-turn conversations in the Hermes ChatML format

### When to Use Each Format

| Format | When to Use |
|---|---|
| `default` | Models served with OpenAI-compatible tool support (Ollama with native tools, vLLM with `--tool-call-parser hermes`, OpenRouter) |
| `hermes` | Raw Hermes models via llama.cpp or vLLM without automatic tool-call conversion |
| `lfm` | Liquid Foundation Models |

## Supported Providers

| Provider | Key | Notes |
|---|---|---|
| OpenRouter | `openrouter` | Cloud API — best for Hermes 3 405B, comparison models |
| Ollama | `ollama` | Local — `ollama pull hermes3:8b` handles Hermes format natively |
| llama.cpp | `llamacpp` | Local — use `--chat-template hermes2pro` flag |
| vLLM | `vllm` | Local/cloud — use `--tool-call-parser hermes --enable-auto-tool-choice` |
| mlx_lm | `mlx` | Apple Silicon local inference |
| LM Studio | `lmstudio` | GUI-based local inference |

## Getting Started

### Requirements

- Node.js 20 or newer
- npm
- At least one reachable OpenAI-compatible provider with a Hermes model

### Install

```bash
npm install
cp .env.example .env
```

Edit `.env` with your providers and models.

### Recommended Hermes Setup

**Quick start with Ollama:**
```bash
ollama pull hermes3:8b
```

```env
OLLAMA_HOST=http://localhost:11434
LLM_MODELS=ollama:hermes3:8b
```

**Compare Hermes variants via OpenRouter:**
```env
OPENROUTER_API_KEY=your-key
LLM_MODELS=openrouter:nousresearch/hermes-3-llama-3.1-8b,openrouter:nousresearch/hermes-3-llama-3.1-70b
LLM_MODELS_2=openrouter:openai/gpt-4.1,openrouter:anthropic/claude-sonnet-4
```

**Local Hermes with vLLM:**
```bash
vllm serve NousResearch/Hermes-3-Llama-3.1-8B --tool-call-parser hermes --enable-auto-tool-choice
```

```env
VLLM_HOST=http://localhost:8000
LLM_MODELS=vllm:NousResearch/Hermes-3-Llama-3.1-8B
```

### Run

```bash
npm run dev
```

Open `http://localhost:3000`.

### Validation

```bash
npm run lint
npm run typecheck
```

## Dashboard Behavior

- The runner advances scenario-by-scenario, not model-by-model.
- Score cards show accuracy percentage, average latency, average turns, context window, and estimated cost.
- The config button opens a modal for generation parameters and **Tools Format** (default/hermes/lfm).
- `Shift+Click` a scenario header to rerun only that scenario across all models.
- Clicking a cell opens the raw trace for inspection.

## Scoring Dimensions

### 1. Tool-Call Accuracy (0-100%)

The core benchmark score. See [METHODOLOGY.md](./METHODOLOGY.md) for the full 15-scenario specification.

### 2. Speed & Latency

Measured end-to-end per scenario (includes all turns). Displayed as average latency across scenarios. Lower is better. Critical for agent responsiveness.

### 3. Context Window

Pulled from a built-in lookup table of known Hermes and popular models, overridable via `MODEL_CONTEXT_WINDOWS` env var. Larger context = better for complex multi-step agent tasks.

### 4. Cost

Estimated from known per-million-token rates for cloud providers. Local models show no cost. Useful for comparing cloud Hermes variants against each other.

### 5. Setup Compatibility

The Tools Format selector lets you test whether a model works better with:
- Native OpenAI tool calling (`default`)
- Hermes ChatML prompt injection (`hermes`)
- LFM format (`lfm`)

This reveals which serving configuration produces the best results for each model.

## Repository Structure

- [app/](./app) — Next.js app router entry points and styles.
- [components/dashboard.tsx](./components/dashboard.tsx) — Benchmark UI and live event handling.
- [app/api/run/route.ts](./app/api/run/route.ts) — Streams benchmark progress over SSE.
- [lib/benchmark.ts](./lib/benchmark.ts) — Benchmark spec, mocked tools, scoring logic, and extended metrics.
- [lib/orchestrator.ts](./lib/orchestrator.ts) — Runs scenarios, captures traces and timing.
- [lib/llm-client.ts](./lib/llm-client.ts) — OpenAI-compatible client with Hermes/LFM format adapters.
- [lib/models.ts](./lib/models.ts) — Provider config, model metadata (context window, cost).

## Limitations

- This isolates tool-use behavior under a fixed tool schema — not a general intelligence benchmark.
- Mocked tools measure orchestration quality, not live service quality.
- Cost estimates are rough approximations based on typical token counts.
- Latency includes network overhead and varies by provider infrastructure.

## Credits

Based on [ToolCall-15](https://github.com/stevibe/toolcall-15) by [stevibe](https://x.com/stevibe), released under the MIT License.

## License

MIT License. See [LICENSE](./LICENSE).
