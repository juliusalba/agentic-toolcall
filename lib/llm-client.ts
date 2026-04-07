import { SYSTEM_PROMPT, UNIVERSAL_TOOLS } from "@/lib/benchmark";
import type { ModelConfig } from "@/lib/models";

export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ProviderToolCall[];
  tool_call_id?: string;
};

export type ProviderToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type AssistantResponse = {
  content: string;
  toolCalls: ProviderToolCall[];
  reasoning?: string;
};

export type GenerationParams = {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
  tools_format?: "default" | "lfm" | "hermes";
};

const DEFAULT_MODEL_REQUEST_TIMEOUT_SECONDS = 30;

type ChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
      reasoning_content?: string;
      reasoning?: string;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string | Record<string, unknown>;
        };
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

type ProviderMessage = NonNullable<NonNullable<ChatResponse["choices"]>[number]["message"]>;
type ProviderContent = ProviderMessage["content"];

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function normalizeContent(content: ProviderContent): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part?.type === "text" ? part.text ?? "" : ""))
      .join("")
      .trim();
  }

  return "";
}

function normalizeToolCalls(message: ProviderMessage): ProviderToolCall[] {
  return (
    message?.tool_calls?.map((call: NonNullable<ProviderMessage["tool_calls"]>[number], index: number) => ({
      id: call.id ?? `tool_call_${index + 1}`,
      type: "function",
      function: {
        name: call.function?.name ?? "unknown_tool",
        arguments:
          typeof call.function?.arguments === "string"
            ? call.function.arguments
            : JSON.stringify(call.function?.arguments ?? {})
      }
    })) ?? []
  );
}

// --- Hermes helpers ---

function buildHermesToolsBlock(): string {
  const toolList = UNIVERSAL_TOOLS.map((t) => ({
    type: "function",
    function: t.function
  }));
  return `You are a function calling AI model. You are provided with function signatures within <tools></tools> XML tags. You may call one or more functions to assist with the user query. Don't make assumptions about what values to plug into functions. Here are the available tools:

<tools>
${JSON.stringify(toolList, null, 2)}
</tools>

For each function call return a json object with function name and arguments within <tool_call></tool_call> XML tags:
<tool_call>
{"name": "<function-name>", "arguments": <args-json-object>}
</tool_call>`;
}

function buildHermesMessages(messages: ModelMessage[]): ModelMessage[] {
  const hermesToolBlock = buildHermesToolsBlock();

  return messages.map((msg): ModelMessage => {
    if (msg.role === "system") {
      return { ...msg, content: msg.content + "\n\n" + hermesToolBlock };
    }

    // Re-serialize assistant tool calls into Hermes <tool_call> format for multi-turn history
    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      const toolCallBlocks = msg.tool_calls.map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch { /* ignore */ }
        return `<tool_call>\n{"name": "${tc.function.name}", "arguments": ${JSON.stringify(args)}}\n</tool_call>`;
      }).join("\n");
      return {
        role: "assistant",
        content: msg.content ? `${msg.content}\n${toolCallBlocks}` : toolCallBlocks
      };
    }

    // Wrap tool results in <tool_response> tags
    if (msg.role === "tool") {
      return {
        ...msg,
        content: `<tool_response>\n${msg.content}\n</tool_response>`
      };
    }

    return msg;
  });
}

function parseHermesResponse(content: string): { content: string; toolCalls: ProviderToolCall[] } {
  const toolCalls: ProviderToolCall[] = [];
  let callIndex = 0;
  const blocks = content.match(/<tool_call>([\s\S]*?)<\/tool_call>/g) ?? [];

  for (const block of blocks) {
    const inner = block.replace(/<tool_call>/, "").replace(/<\/tool_call>/, "").trim();
    try {
      const parsed = JSON.parse(inner) as { name?: string; arguments?: unknown };
      if (parsed?.name) {
        toolCalls.push({
          id: `tool_call_${++callIndex}`,
          type: "function",
          function: {
            name: parsed.name,
            arguments: typeof parsed.arguments === "string" ? parsed.arguments : JSON.stringify(parsed.arguments ?? {})
          }
        });
      }
    } catch {
      // Try to salvage partially malformed JSON
      const nameMatch = inner.match(/"name"\s*:\s*"([^"]+)"/);
      const argsMatch = inner.match(/"arguments"\s*:\s*(\{[\s\S]*\})/);
      if (nameMatch) {
        toolCalls.push({
          id: `tool_call_${++callIndex}`,
          type: "function",
          function: {
            name: nameMatch[1],
            arguments: argsMatch ? argsMatch[1] : "{}"
          }
        });
      }
    }
  }

  const cleanedContent = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
  return { content: cleanedContent, toolCalls };
}

// --- LFM helpers ---

function toPythonValue(val: unknown): string {
  if (typeof val === "string") return `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  if (typeof val === "boolean") return val ? "True" : "False";
  if (val === null || val === undefined) return "None";
  if (typeof val === "number") return String(val);
  return JSON.stringify(val);
}

function serializeToolCallsToLfm(toolCalls: ProviderToolCall[]): string {
  const callsStr = toolCalls.map((tc) => {
    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(tc.function.arguments || "{}");
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch { /* ignore */ }
    const argsStr = Object.entries(args).map(([k, v]) => `${k}=${toPythonValue(v)}`).join(", ");
    return `${tc.function.name}(${argsStr})`;
  }).join(", ");
  return `<|tool_call_start|>[${callsStr}]<|tool_call_end|>`;
}

function buildLfmMessages(messages: ModelMessage[]): ModelMessage[] {
  const toolList = UNIVERSAL_TOOLS.map((t) => t.function);
  const injection = `\n\nList of tools: ${JSON.stringify(toolList)}\n`;

  return messages.map((msg): ModelMessage => {
    if (msg.role === "system") {
      return { ...msg, content: msg.content + injection };
    }

    // Re-serialize assistant tool calls back into LFM format for multi-turn history.
    // The LFM model is not trained on the OpenAI structured tool_calls field.
    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      const lfmBlock = serializeToolCallsToLfm(msg.tool_calls);
      return {
        role: "assistant",
        content: msg.content ? `${msg.content}\n${lfmBlock}` : lfmBlock
      };
    }

    return msg;
  });
}

// --- Pythonic call parser ---

function splitTopLevel(input: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inString = false;
  let stringChar = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index];

    if (inString) {
      if (ch === "\\" && index + 1 < input.length) {
        current += ch + input[index + 1];
        index += 1;
      } else if (ch === stringChar) {
        inString = false;
        current += ch;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true; stringChar = ch; current += ch;
      continue;
    }

    if (ch === "(") {
      parenDepth += 1;
    } else if (ch === ")" && parenDepth > 0) {
      parenDepth -= 1;
    } else if (ch === "[") {
      bracketDepth += 1;
    } else if (ch === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (ch === "{") {
      braceDepth += 1;
    } else if (ch === "}" && braceDepth > 0) {
      braceDepth -= 1;
    } else if (ch === delimiter && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      const part = current.trim();
      if (part) {
        parts.push(part);
      }
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function findTopLevelChar(input: string, target: string): number {
  let inString = false;
  let stringChar = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index];

    if (inString) {
      if (ch === "\\" && index + 1 < input.length) {
        index += 1;
      } else if (ch === stringChar) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === "(") {
      parenDepth += 1;
      continue;
    }

    if (ch === ")" && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }

    if (ch === "[") {
      bracketDepth += 1;
      continue;
    }

    if (ch === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
      continue;
    }

    if (ch === "{") {
      braceDepth += 1;
      continue;
    }

    if (ch === "}" && braceDepth > 0) {
      braceDepth -= 1;
      continue;
    }

    if (ch === target && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      return index;
    }
  }

  return -1;
}

function parsePythonValue(raw: string): unknown {
  const t = raw.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1).trim();
    return inner ? splitTopLevel(inner, ",").map((part) => parsePythonValue(part)) : [];
  }
  if (t.startsWith("{") && t.endsWith("}")) {
    const inner = t.slice(1, -1).trim();
    const objectValue: Record<string, unknown> = {};

    if (!inner) {
      return objectValue;
    }

    for (const entry of splitTopLevel(inner, ",")) {
      const separatorIndex = findTopLevelChar(entry, ":");

      if (separatorIndex === -1) {
        continue;
      }

      const keyValue = parsePythonValue(entry.slice(0, separatorIndex).trim());
      const objectKey = typeof keyValue === "string" ? keyValue : String(keyValue);
      objectValue[objectKey] = parsePythonValue(entry.slice(separatorIndex + 1).trim());
    }

    return objectValue;
  }
  if (t === "True") return true;
  if (t === "False") return false;
  if (t === "None") return null;
  const num = Number(t);
  if (!isNaN(num) && t !== "") return num;
  return t;
}

function parsePythonicCalls(text: string): Array<{ name: string; args: Record<string, unknown> }> {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let i = 0;

  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (i >= text.length) break;

    const nameStart = i;
    while (i < text.length && /\w/.test(text[i])) i++;
    const name = text.slice(nameStart, i);
    if (!name) { i++; continue; }

    while (i < text.length && text[i] === " ") i++;
    if (i >= text.length || text[i] !== "(") continue;
    i++;

    const argsStart = i;
    let depth = 1;
    let inString = false;
    let stringChar = "";
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (inString) {
        if (ch === "\\" && i + 1 < text.length) { i += 2; continue; }
        if (ch === stringChar) inString = false;
      } else if (ch === '"' || ch === "'") {
        inString = true; stringChar = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    const argsStr = text.slice(argsStart, i);
    i++;

    const args: Record<string, unknown> = {};
    for (const part of splitTopLevel(argsStr, ",")) {
      const eq = findTopLevelChar(part, "=");
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      if (key) args[key] = parsePythonValue(part.slice(eq + 1).trim());
    }
    calls.push({ name, args });
  }
  return calls;
}

// ---

function parseLfmResponse(content: string): { content: string; toolCalls: ProviderToolCall[] } {
  const toolCalls: ProviderToolCall[] = [];
  let callIndex = 0;
  const blocks = content.match(/<\|tool_call_start\|>([\s\S]*?)<\|tool_call_end\|>/g) ?? [];

  for (const block of blocks) {
    const inner = block.replace(/<\|tool_call_start\|>/, "").replace(/<\|tool_call_end\|>/, "").trim();
    try {
      const parsed = JSON.parse(inner) as Array<{ name?: string; arguments?: unknown }>;
      for (const call of Array.isArray(parsed) ? parsed : [parsed]) {
        if (call?.name) {
          toolCalls.push({
            id: `tool_call_${++callIndex}`,
            type: "function",
            function: {
              name: call.name,
              arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {})
            }
          });
        }
      }
    } catch {
      // ignore malformed blocks
    }
  }

  if (toolCalls.length > 0) {
    return {
      content: content.replace(/<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/g, "").trim(),
      toolCalls
    };
  }

  // Fallback: server stripped the special tokens, leaving bare content.
  // Try JSON first, then pythonic format.
  const trimmed = content.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as Array<{ name?: string; arguments?: unknown }>;
      for (const call of Array.isArray(parsed) ? parsed : []) {
        if (call?.name) {
          toolCalls.push({
            id: `tool_call_${++callIndex}`,
            type: "function",
            function: {
              name: call.name,
              arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {})
            }
          });
        }
      }
      if (toolCalls.length > 0) return { content: "", toolCalls };
    } catch {
      // not JSON — fall through to pythonic
    }

    const inner = trimmed.slice(1, -1).trim();
    for (const call of parsePythonicCalls(inner)) {
      toolCalls.push({
        id: `tool_call_${++callIndex}`,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.args) }
      });
    }
    if (toolCalls.length > 0) return { content: "", toolCalls };
  }

  return { content, toolCalls };
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "TimeoutError" || error.name === "AbortError";
}

function resolveRequestTimeoutMs(): number {
  const rawTimeout = process.env.MODEL_REQUEST_TIMEOUT_SECONDS?.trim();

  if (!rawTimeout) {
    return DEFAULT_MODEL_REQUEST_TIMEOUT_SECONDS * 1000;
  }

  const parsed = Number.parseInt(rawTimeout, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MODEL_REQUEST_TIMEOUT_SECONDS * 1000;
  }

  return parsed * 1000;
}

export async function callModel(model: ModelConfig, messages: ModelMessage[], params?: GenerationParams): Promise<AssistantResponse> {
  const baseUrl = normalizeBaseUrl(model.baseUrl);
  const requestTimeoutMs = resolveRequestTimeoutMs();
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (model.apiKey) {
    headers.Authorization = `Bearer ${model.apiKey}`;
  }

  const toolsFormat = params?.tools_format ?? "default";
  const useLfmFormat = toolsFormat === "lfm";
  const useHermesFormat = toolsFormat === "hermes";
  const usePromptInjection = useLfmFormat || useHermesFormat;

  const resolvedMessages = useHermesFormat
    ? buildHermesMessages(messages)
    : useLfmFormat
      ? buildLfmMessages(messages)
      : messages;

  const body: Record<string, unknown> = {
    model: model.model,
    temperature: params?.temperature ?? 0,
    messages: resolvedMessages,
    ...(usePromptInjection ? {} : { parallel_tool_calls: true, tool_choice: "auto", tools: UNIVERSAL_TOOLS })
  };

  if (params?.top_p !== undefined) {
    body.top_p = params.top_p;
  }

  if (params?.top_k !== undefined) {
    body.top_k = params.top_k;
  }

  if (params?.min_p !== undefined) {
    body.min_p = params.min_p;
  }

  if (params?.repetition_penalty !== undefined) {
    body.repetition_penalty = params.repetition_penalty;
  }

  let response: Response;

  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(`Request timed out after ${requestTimeoutMs / 1000}s.`);
    }

    throw error;
  }

  const payload = (await response.json()) as ChatResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || `Provider request failed with ${response.status}.`);
  }

  const message = payload.choices?.[0]?.message;

  if (!message) {
    throw new Error("Provider returned no assistant message.");
  }

  if (useHermesFormat) {
    const parsed = parseHermesResponse(normalizeContent(message.content));
    // Some serving backends (Ollama, vLLM) convert <tool_call> tags into structured
    // tool_calls in the response — check there as fallback.
    if (parsed.toolCalls.length === 0 && (message.tool_calls?.length ?? 0) > 0) {
      return { content: parsed.content, toolCalls: normalizeToolCalls(message) };
    }
    return { content: parsed.content, toolCalls: parsed.toolCalls };
  }

  if (useLfmFormat) {
    const parsed = parseLfmResponse(normalizeContent(message.content));
    if (parsed.toolCalls.length === 0 && (message.tool_calls?.length ?? 0) > 0) {
      return { content: parsed.content, toolCalls: normalizeToolCalls(message) };
    }
    return { content: parsed.content, toolCalls: parsed.toolCalls };
  }

  return {
    content: normalizeContent(message.content),
    toolCalls: normalizeToolCalls(message),
    reasoning: message.reasoning_content ?? message.reasoning
  };
}

export function createInitialMessages(userMessage: string): ModelMessage[] {
  return [
    { role: "system", content: `${SYSTEM_PROMPT}\n\nBenchmark context: today is 2026-03-20 (Friday). Use this date for any relative time request.` },
    { role: "user", content: userMessage }
  ];
}
