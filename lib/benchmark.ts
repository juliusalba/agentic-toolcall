export const SYSTEM_PROMPT = `You are a helpful assistant with access to the tools provided.

Rules:
- Use a tool ONLY when it is necessary to fulfill the user's request.
- If you can answer directly from your own knowledge, do so without calling a tool.
- If a tool call fails, explain the failure and suggest an alternative approach.
- Never invent information that a tool should provide.`;

export const BENCHMARK_REFERENCE_DATE = "2026-03-20";
export const BENCHMARK_REFERENCE_DAY = "Friday";

export type BenchmarkCategory = "A" | "B" | "C" | "D" | "E";
export type ScenarioStatus = "pass" | "partial" | "fail";
export type UniversalToolName =
  | "web_search"
  | "get_weather"
  | "calculator"
  | "send_email"
  | "search_files"
  | "read_file"
  | "create_calendar_event"
  | "get_contacts"
  | "translate_text"
  | "get_stock_price"
  | "set_reminder"
  | "run_code";

export type ToolDefinition = {
  type: "function";
  function: {
    name: UniversalToolName;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
};

export type ToolCallRecord = {
  id: string;
  name: string;
  rawArguments: string;
  arguments: Record<string, unknown>;
  turn: number;
};

export type ToolResultRecord = {
  callId: string;
  name: string;
  result: unknown;
};

export type ScenarioState = {
  toolCalls: ToolCallRecord[];
  toolResults: ToolResultRecord[];
  assistantMessages: string[];
  finalAnswer: string;
  meta: Record<string, unknown>;
};

export type ScenarioEvaluation = {
  status: ScenarioStatus;
  points: 0 | 1 | 2;
  summary: string;
  note?: string;
};

export type ScenarioDefinition = {
  id: string;
  title: string;
  category: BenchmarkCategory;
  userMessage: string;
  description: string;
  handleToolCall: (state: ScenarioState, call: ToolCallRecord) => Promise<unknown> | unknown;
  evaluate: (state: ScenarioState) => ScenarioEvaluation;
};

function parseMathExpression(expression: string): number | null {
  // Safe math evaluation without eval/Function — only allows numbers and basic operators
  const sanitized = expression.replaceAll(",", "").trim();
  if (!/^[\d\s()+\-*/.%]+$/.test(sanitized)) return null;
  if (sanitized.length > 200) return null; // prevent abuse

  try {
    // Use Function with strict validation — the regex above guarantees only digits/operators
    // This is safe because the character set is locked to [0-9 ()+\-*/.%]
    const result = new Function(`"use strict"; return (${sanitized});`)() as unknown;
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function includesText(value: unknown, expected: string): boolean {
  return asString(value).toLowerCase().includes(expected.toLowerCase());
}

function mentionsAll(text: string, values: string[]): boolean {
  const normalizedText = normalize(text);
  return values.every((value) => normalizedText.includes(normalize(value)));
}

function answerContainsNumber(answer: string, value: string): boolean {
  const collapsed = answer.replaceAll(",", "").toLowerCase();
  return collapsed.includes(value.replaceAll(",", "").toLowerCase());
}

function fullAssistantTranscript(state: ScenarioState): string {
  return state.assistantMessages.join("\n");
}

function toolCallsByName(state: ScenarioState, name: string): ToolCallRecord[] {
  return state.toolCalls.filter((call) => call.name === name);
}

function hasToolCall(state: ScenarioState, name: string, predicate?: (call: ToolCallRecord) => boolean): boolean {
  return toolCallsByName(state, name).some((call) => (predicate ? predicate(call) : true));
}

function firstCall(state: ScenarioState, name: string): ToolCallRecord | undefined {
  return toolCallsByName(state, name)[0];
}

function isOnlyTool(state: ScenarioState, name: string): boolean {
  return state.toolCalls.length > 0 && state.toolCalls.every((call) => call.name === name);
}

function containsRefusal(answer: string): boolean {
  const lowered = answer.toLowerCase();
  return (
    lowered.includes("cannot") ||
    lowered.includes("can't") ||
    lowered.includes("do not have") ||
    lowered.includes("don't have") ||
    lowered.includes("not able")
  );
}

function asksForClarification(answer: string): boolean {
  const lowered = answer.toLowerCase();
  return lowered.includes("which") || lowered.includes("clarify") || lowered.includes("could you");
}

function hasCurrentToolMisuse(state: ScenarioState, allowedTools: string[]): boolean {
  return state.toolCalls.some((call) => !allowedTools.includes(call.name));
}

export const UNIVERSAL_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for current information",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          max_results: { type: "integer", default: 5 }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather for a specific location",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string" },
          units: { type: "string", enum: ["celsius", "fahrenheit"], default: "celsius" }
        },
        required: ["location"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "calculator",
      description: "Perform mathematical calculations",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string" }
        },
        required: ["expression"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description: "Send an email to a recipient",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          attachments: { type: "array", items: { type: "string" }, default: [] }
        },
        required: ["to", "subject", "body"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for files by name or content",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          file_type: { type: "string", enum: ["pdf", "docx", "xlsx", "any"], default: "any" }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a specific file",
      parameters: {
        type: "object",
        properties: {
          file_id: { type: "string" }
        },
        required: ["file_id"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_calendar_event",
      description: "Create a new calendar event",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          date: { type: "string", format: "YYYY-MM-DD" },
          time: { type: "string", format: "HH:MM" },
          duration_minutes: { type: "integer", default: 60 },
          attendees: { type: "array", items: { type: "string" }, default: [] }
        },
        required: ["title", "date", "time"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_contacts",
      description: "Look up contacts by name or group",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "translate_text",
      description: "Translate text from one language to another",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          source_language: { type: "string" },
          target_language: { type: "string" }
        },
        required: ["text", "source_language", "target_language"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_stock_price",
      description: "Get the current stock price for a ticker symbol",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string" }
        },
        required: ["ticker"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "set_reminder",
      description: "Set a reminder for a future time",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string" },
          datetime: { type: "string", format: "ISO 8601" }
        },
        required: ["message", "datetime"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_code",
      description: "Execute a code snippet and return the output",
      parameters: {
        type: "object",
        properties: {
          language: { type: "string", enum: ["python", "javascript"] },
          code: { type: "string" }
        },
        required: ["language", "code"],
        additionalProperties: false
      }
    }
  }
];

function genericToolFallback(call: ToolCallRecord): unknown {
  switch (call.name) {
    case "calculator": {
      const result = parseMathExpression(asString(call.arguments.expression));
      return result === null ? { error: "Invalid expression." } : { result };
    }
    case "web_search":
      return { results: [{ snippet: `Search results for ${asString(call.arguments.query)}` }] };
    case "run_code":
      return { error: "Code execution is disabled in benchmark mocks." };
    default:
      return { error: `Tool ${call.name} is not relevant for this scenario.` };
  }
}

export const SCENARIOS: ScenarioDefinition[] = [
  // ═══════════════════════════════════════════════
  // Category A — Quick Lookups (easy daily tasks)
  // ═══════════════════════════════════════════════
  {
    id: "TC-01",
    title: "Weather Check",
    category: "A",
    userMessage: "What's the weather like in Berlin right now?",
    description: "Use the specialist get_weather tool instead of web_search.",
    handleToolCall(_state, call) {
      if (call.name === "get_weather") {
        return {
          location: "Berlin",
          temperature: 8,
          units: "celsius",
          condition: "Overcast",
          humidity: 72
        };
      }

      if (call.name === "web_search") {
        return {
          results: [{ snippet: "Berlin weather right now: 8C and overcast." }]
        };
      }

      return genericToolFallback(call);
    },
    evaluate(state) {
      const usedWeather = hasToolCall(state, "get_weather", (call) => includesText(call.arguments.location, "berlin"));
      const usedWeb = hasToolCall(state, "web_search");

      if (usedWeather && !usedWeb && state.toolCalls.length === 1) {
        return { status: "pass", points: 2, summary: "Used get_weather with Berlin only." };
      }

      if (!usedWeather && usedWeb && isOnlyTool(state, "web_search")) {
        return { status: "partial", points: 1, summary: "Answered functionally via web_search, but missed the specialist tool." };
      }

      return { status: "fail", points: 0, summary: "Did not cleanly route the request to get_weather." };
    }
  },
  {
    id: "TC-02",
    title: "Stock Price Lookup",
    category: "A",
    userMessage: "What is the current price of AAPL stock?",
    description: "Pick get_stock_price from 12 available tools, ignore distractors.",
    handleToolCall(_state, call) {
      if (call.name === "get_stock_price") {
        return {
          ticker: "AAPL",
          price: 187.42,
          currency: "USD",
          change: "+1.23",
          change_percent: "+0.66%"
        };
      }

      if (call.name === "web_search") {
        return { results: [{ snippet: "AAPL is trading around $187.42." }] };
      }

      return genericToolFallback(call);
    },
    evaluate(state) {
      const stockCall = hasToolCall(state, "get_stock_price", (call) => normalize(asString(call.arguments.ticker)) === "aapl");
      const webCall = hasToolCall(state, "web_search");

      if (stockCall && !webCall && state.toolCalls.length === 1) {
        return { status: "pass", points: 2, summary: "Used only get_stock_price for AAPL." };
      }

      if (stockCall && webCall) {
        return { status: "partial", points: 1, summary: "Called the right tool, but added unnecessary web_search." };
      }

      return { status: "fail", points: 0, summary: "Did not isolate the request to get_stock_price." };
    }
  },
  {
    id: "TC-03",
    title: "Common Knowledge",
    category: "A",
    userMessage: "What's the capital of France?",
    description: "Answer from knowledge without calling any tool.",
    handleToolCall(_state, call) {
      return genericToolFallback(call);
    },
    evaluate(state) {
      if (state.toolCalls.length === 0 && /paris/i.test(state.finalAnswer)) {
        return { status: "pass", points: 2, summary: "Answered Paris directly without tool use." };
      }

      if (state.toolCalls.length > 0 && /paris/i.test(state.finalAnswer)) {
        return { status: "partial", points: 1, summary: "Correct answer but used tools unnecessarily for common knowledge." };
      }

      return { status: "fail", points: 0, summary: "Did not answer correctly or used tools for common knowledge." };
    }
  },

  // ═══════════════════════════════════════════════
  // Category B — Precision (getting details right)
  // ═══════════════════════════════════════════════
  {
    id: "TC-04",
    title: "Specific Units",
    category: "B",
    userMessage: "What's the temperature in Tokyo in Fahrenheit?",
    description: "Pass the explicit units parameter instead of using the default.",
    handleToolCall(_state, call) {
      if (call.name === "get_weather") {
        const units = normalize(asString(call.arguments.units)) || "celsius";

        if (units === "fahrenheit") {
          return { location: "Tokyo", temperature: 64, units: "fahrenheit", condition: "Clear" };
        }

        return { location: "Tokyo", temperature: 18, units: "celsius", condition: "Clear" };
      }

      return genericToolFallback(call);
    },
    evaluate(state) {
      const weatherCall = firstCall(state, "get_weather");

      if (
        weatherCall &&
        includesText(weatherCall.arguments.location, "tokyo") &&
        normalize(asString(weatherCall.arguments.units)) === "fahrenheit"
      ) {
        return { status: "pass", points: 2, summary: "Requested Tokyo weather in Fahrenheit explicitly." };
      }

      if (
        weatherCall &&
        includesText(weatherCall.arguments.location, "tokyo") &&
        !asString(weatherCall.arguments.units) &&
        (state.finalAnswer.toLowerCase().includes("fahrenheit") || answerContainsNumber(state.finalAnswer, "64"))
      ) {
        return { status: "partial", points: 1, summary: "Omitted the units parameter and converted manually." };
      }

      return { status: "fail", points: 0, summary: "Did not preserve the Fahrenheit instruction." };
    }
  },
  {
    id: "TC-05",
    title: "Schedule a Meeting",
    category: "B",
    userMessage: "Schedule a team standup for next Monday at 9:30am, 30 minutes, with Alex and Jamie.",
    description: "Parse relative date, time format, duration, and attendee list into structured parameters.",
    handleToolCall(_state, call) {
      if (call.name === "get_contacts") {
        return {
          results: [
            { name: "Alex Stone", email: "alex.stone@company.com" },
            { name: "Jamie Liu", email: "jamie.liu@company.com" }
          ]
        };
      }

      if (call.name === "create_calendar_event") {
        return {
          event_id: "evt_4412",
          status: "created",
          title: asString(call.arguments.title) || "Team Standup",
          date: asString(call.arguments.date)
        };
      }

      return genericToolFallback(call);
    },
    evaluate(state) {
      const eventCall = firstCall(state, "create_calendar_event");

      if (!eventCall) {
        return { status: "fail", points: 0, summary: "Did not create the calendar event." };
      }

      const attendees = asStringArray(eventCall.arguments.attendees);
      const hasDuration = Number(eventCall.arguments.duration_minutes) === 30;
      const hasAttendees = attendees.some((value) => includesText(value, "alex")) && attendees.some((value) => includesText(value, "jamie"));
      const correctDate = asString(eventCall.arguments.date) === "2026-03-23";
      const correctTime = asString(eventCall.arguments.time) === "09:30";

      if (correctDate && correctTime && hasDuration && hasAttendees) {
        return { status: "pass", points: 2, summary: "Parsed next Monday and included the requested meeting details." };
      }

      if (correctDate && correctTime) {
        return { status: "partial", points: 1, summary: "Got the date and time right, but missed some optional structure." };
      }

      return { status: "fail", points: 0, summary: "Relative date or time parsing was incorrect." };
    }
  },
  {
    id: "TC-06",
    title: "Translate to Two Languages",
    category: "B",
    userMessage: "Translate 'Where is the nearest hospital?' from English to both Spanish and Japanese.",
    description: "Split a one-to-many request into two separate tool calls with correct parameters.",
    handleToolCall(_state, call) {
      if (call.name === "translate_text") {
        const target = normalize(asString(call.arguments.target_language));

        if (target === "spanish") {
          return { translated: "¿Dónde está el hospital más cercano?" };
        }

        if (target === "japanese") {
          return { translated: "最寄りの病院はどこですか？" };
        }

        return { error: `Unsupported target language ${target}.` };
      }

      return genericToolFallback(call);
    },
    evaluate(state) {
      const translateCalls = toolCallsByName(state, "translate_text");
      const hasSpanish = translateCalls.some(
        (call) =>
          normalize(asString(call.arguments.source_language)) === "english" &&
          normalize(asString(call.arguments.target_language)) === "spanish" &&
          includesText(call.arguments.text, "nearest hospital")
      );
      const hasJapanese = translateCalls.some(
        (call) =>
          normalize(asString(call.arguments.source_language)) === "english" &&
          normalize(asString(call.arguments.target_language)) === "japanese" &&
          includesText(call.arguments.text, "nearest hospital")
      );
      const invalidBundledTarget = translateCalls.some((call) =>
        /spanish.*japanese|japanese.*spanish/i.test(asString(call.arguments.target_language))
      );

      if (translateCalls.length >= 2 && hasSpanish && hasJapanese && !invalidBundledTarget) {
        return { status: "pass", points: 2, summary: "Issued separate translate_text calls for both languages." };
      }

      // Partial: got one language right
      if (translateCalls.length >= 1 && (hasSpanish || hasJapanese) && !invalidBundledTarget) {
        return { status: "partial", points: 1, summary: "Translated to one language but missed the other." };
      }

      return { status: "fail", points: 0, summary: "Did not split the translation request into two valid tool calls." };
    }
  },
  // ═══════════════════════════════════════════════
  // Category C — Multi-Tool (chaining actions)
  // ═══════════════════════════════════════════════
  {
    id: "TC-07",
    title: "Message a Colleague",
    category: "C",
    userMessage: "I need to let Sarah know the meeting moved to 3pm.",
    description: "Infer the need for contact lookup before sending the email.",
    handleToolCall(_state, call) {
      if (call.name === "get_contacts") {
        return { results: [{ name: "Sarah Chen", email: "sarah.chen@company.com" }] };
      }
      if (call.name === "send_email") {
        return { status: "sent", message_id: "msg_8821" };
      }
      return genericToolFallback(call);
    },
    evaluate(state) {
      const contactCall = firstCall(state, "get_contacts");
      const emailCall = firstCall(state, "send_email");
      if (contactCall && emailCall && contactCall.turn < emailCall.turn && includesText(contactCall.arguments.query, "sarah") && normalize(asString(emailCall.arguments.to)) === "sarah.chen@company.com") {
        return { status: "pass", points: 2, summary: "Looked up Sarah, then emailed the correct address." };
      }
      if (!contactCall && !emailCall && /email/i.test(state.finalAnswer) && /\?/.test(state.finalAnswer)) {
        return { status: "partial", points: 1, summary: "Asked for Sarah's email instead of inferring the lookup." };
      }
      return { status: "fail", points: 0, summary: "Did not complete the contact lookup → email chain." };
    }
  },
  {
    id: "TC-08",
    title: "Two Tasks at Once",
    category: "C",
    userMessage: "What's the weather in London and the stock price of MSFT?",
    description: "Handle two independent requests — ideally with parallel tool calls.",
    handleToolCall(_state, call) {
      if (call.name === "get_weather") return { location: "London", temperature: 12, condition: "Cloudy" };
      if (call.name === "get_stock_price") return { ticker: "MSFT", price: 412.78, currency: "USD" };
      if (call.name === "web_search") return { results: [{ snippet: "London is cloudy at 12C and MSFT is around $412.78." }] };
      return genericToolFallback(call);
    },
    evaluate(state) {
      const weatherCall = hasToolCall(state, "get_weather", (call) => includesText(call.arguments.location, "london"));
      const stockCall = hasToolCall(state, "get_stock_price", (call) => normalize(asString(call.arguments.ticker)) === "msft");
      const batch = state.toolCalls.filter((c) => c.turn === 1);
      const parallel = batch.some((c) => c.name === "get_weather") && batch.some((c) => c.name === "get_stock_price");
      if (weatherCall && stockCall) return { status: "pass", points: 2, summary: "Both independent tools called.", note: parallel ? "Parallel in one turn." : undefined };
      if (hasToolCall(state, "web_search")) return { status: "partial", points: 1, summary: "Fell back to web_search instead of specialist tools." };
      return { status: "fail", points: 0, summary: "Missed one of the two requests." };
    }
  },
  {
    id: "TC-09",
    title: "Conditional Action",
    category: "C",
    userMessage: "Check the weather in Paris. If it's raining, remind me to bring an umbrella tomorrow at 8am.",
    description: "Read a tool result, make a conditional decision, then act accordingly.",
    handleToolCall(_state, call) {
      if (call.name === "get_weather") return { location: "Paris", temperature: 11, condition: "Light rain", humidity: 89 };
      if (call.name === "set_reminder") return { reminder_id: "rem_553", status: "set" };
      return genericToolFallback(call);
    },
    evaluate(state) {
      const weatherCall = firstCall(state, "get_weather");
      const reminderCall = firstCall(state, "set_reminder");
      const dt = asString(reminderCall?.arguments.datetime);
      const validDate = dt.includes("2026-03-21") && (dt.includes("08:00") || dt.includes("8:00"));
      if (weatherCall && reminderCall && weatherCall.turn < reminderCall.turn && includesText(reminderCall.arguments.message, "umbrella") && validDate) {
        return { status: "pass", points: 2, summary: "Weather → rain detected → reminder set correctly." };
      }
      if (weatherCall && !reminderCall && asksForClarification(state.finalAnswer)) {
        return { status: "partial", points: 1, summary: "Checked weather but didn't set the reminder." };
      }
      return { status: "fail", points: 0, summary: "Did not follow the conditional weather → reminder flow." };
    }
  },

  // ═══════════════════════════════════════════════
  // Category D — Judgment (knowing limits + complex)
  // ═══════════════════════════════════════════════
  {
    id: "TC-10",
    title: "Quick Mental Math",
    category: "D",
    userMessage: "My team of 5 is ordering lunch at $12 per person. What's the total?",
    description: "Do simple daily math without reaching for the calculator tool.",
    handleToolCall(_state, call) {
      return genericToolFallback(call);
    },
    evaluate(state) {
      const correct = answerContainsNumber(state.finalAnswer, "60");
      if (state.toolCalls.length === 0 && correct) {
        return { status: "pass", points: 2, summary: "Calculated $60 directly, no tools." };
      }
      if (hasToolCall(state, "calculator") && correct) {
        return { status: "partial", points: 1, summary: "Correct but used calculator for trivial math." };
      }
      return { status: "fail", points: 0, summary: "Wrong answer or unnecessary tool use." };
    }
  },
  {
    id: "TC-11",
    title: "Impossible Request",
    category: "D",
    userMessage: "Delete all my emails from last month.",
    description: "Refuse gracefully — no delete tool exists in the available set.",
    handleToolCall(_state, call) {
      return genericToolFallback(call);
    },
    evaluate(state) {
      if (state.toolCalls.length === 0 && containsRefusal(state.finalAnswer) && (/delete/i.test(state.finalAnswer) || /available tool/i.test(state.finalAnswer))) {
        return { status: "pass", points: 2, summary: "Refused cleanly, explained the limitation." };
      }
      return { status: "fail", points: 0, summary: "Did not refuse the unsupported request." };
    }
  },
  {
    id: "TC-12",
    title: "Full Workflow Chain",
    category: "D",
    userMessage: "Find the Q3 budget report and email the total to my manager.",
    description: "Execute a 4-step chain: search file → read content → lookup contact → send email with extracted data.",
    handleToolCall(_state, call) {
      if (call.name === "search_files") return { results: [{ file_id: "file_091", name: "Q3_Budget_Report_2025.xlsx" }] };
      if (call.name === "read_file") return { content: "Department budgets: Engineering $2.1M, Marketing $800K, Sales $1.5M. Total: $4.4M" };
      if (call.name === "get_contacts") return { results: [{ name: "Jordan Park", email: "jordan.park@company.com", role: "manager" }] };
      if (call.name === "send_email") return { status: "sent" };
      return genericToolFallback(call);
    },
    evaluate(state) {
      let steps = 0;
      if (hasToolCall(state, "search_files", (c) => includesText(c.arguments.query, "q3 budget report"))) steps++;
      if (hasToolCall(state, "read_file", (c) => normalize(asString(c.arguments.file_id)) === "file_091")) steps++;
      if (hasToolCall(state, "get_contacts", (c) => includesText(c.arguments.query, "manager"))) steps++;
      if (hasToolCall(state, "send_email", (c) => normalize(asString(c.arguments.to)) === "jordan.park@company.com" && (includesText(c.arguments.body, "4.4m") || includesText(c.arguments.body, "$4.4m")))) steps++;
      if (steps === 4) return { status: "pass", points: 2, summary: "All 4 steps completed with correct data threading." };
      if (steps >= 3) return { status: "partial", points: 1, summary: `${steps}/4 steps completed.` };
      return { status: "fail", points: 0, summary: "Failed to chain the search → read → contact → email workflow." };
    }
  },

  // ═══════════════════════════════════════════════
  // Category E — Resilience (error handling + integrity)
  // ═══════════════════════════════════════════════
  {
    id: "TC-13",
    title: "No Results — Retry",
    category: "E",
    userMessage: "Find the Johnson proposal document.",
    description: "When search returns empty, retry with a broader query or ask for clarification.",
    handleToolCall(state, call) {
      if (call.name === "search_files") {
        const query = normalize(asString(call.arguments.query));
        const attempts = Number(state.meta.searchAttempts ?? 0) + 1;
        state.meta.searchAttempts = attempts;

        if (query.includes("johnson proposal") && attempts === 1) {
          return { results: [] };
        }

        if (query.includes("johnson")) {
          return {
            results: [{ file_id: "file_117", name: "Johnson_Project_Proposal_v2.docx" }]
          };
        }
      }

      return genericToolFallback(call);
    },
    evaluate(state) {
      const searches = toolCallsByName(state, "search_files");
      const retried = searches.length >= 2;
      const clarified = searches.length === 1 && asksForClarification(state.finalAnswer);

      if (retried) {
        return { status: "pass", points: 2, summary: "Retried after the empty result and recovered." };
      }

      if (clarified) {
        return { status: "pass", points: 2, summary: "Asked for clarification after the empty result." };
      }

      return { status: "fail", points: 0, summary: "Did not adapt after the empty search response." };
    }
  },
  {
    id: "TC-14",
    title: "Tool Error Handling",
    category: "E",
    userMessage: "What's Apple's stock price?",
    description: "When a tool returns an error, surface it honestly instead of making up data.",
    handleToolCall(_state, call) {
      if (call.name === "get_stock_price") {
        return { error: "Service temporarily unavailable. Rate limit exceeded." };
      }

      if (call.name === "web_search") {
        return { results: [{ snippet: "Apple (AAPL) is trading around $187.42." }] };
      }

      return genericToolFallback(call);
    },
    evaluate(state) {
      const stockCalls = toolCallsByName(state, "get_stock_price");
      const usedSearch = hasToolCall(state, "web_search");
      const assistantTranscript = fullAssistantTranscript(state);
      const acknowledgedError =
        /temporarily unavailable|rate limit|service/i.test(assistantTranscript) ||
        /couldn't|get_stock_price/i.test(assistantTranscript);
      const offeredAlternative =
        /web search|search(?:ing)?(?: for)?(?: the)? information online|search online|try again|fallback|check .*?(?:website|platform|source)/i.test(
          assistantTranscript
        );

      if (stockCalls.length >= 1 && acknowledgedError && (usedSearch || offeredAlternative)) {
        return { status: "pass", points: 2, summary: "Acknowledged the stock tool failure and handled it gracefully." };
      }

      if (stockCalls.length >= 1 && usedSearch) {
        return { status: "partial", points: 1, summary: "Recovered with web_search, but did not clearly surface the original error." };
      }

      return { status: "fail", points: 0, summary: "Did not handle the tool error with enough integrity." };
    }
  },
  {
    id: "TC-15",
    title: "Data Integrity",
    category: "E",
    userMessage: "Search for the population of Iceland and calculate what 2% of it would be.",
    description: "Use the EXACT number from web_search in the calculator — don't round or guess.",
    handleToolCall(_state, call) {
      if (call.name === "web_search") {
        return {
          results: [{ snippet: "Iceland has a population of approximately 372,520 as of 2025." }]
        };
      }

      if (call.name === "calculator") {
        const result = parseMathExpression(asString(call.arguments.expression));
        return result === null ? { error: "Invalid expression." } : { result };
      }

      return genericToolFallback(call);
    },
    evaluate(state) {
      const searchCall = firstCall(state, "web_search");
      const calculatorCall = firstCall(state, "calculator");

      if (
        searchCall &&
        calculatorCall &&
        includesText(searchCall.arguments.query, "population of iceland") &&
        asString(calculatorCall.arguments.expression).replaceAll(",", "").includes("372520")
      ) {
        return { status: "pass", points: 2, summary: "Used the searched population value in the calculator." };
      }

      // Accept reasonable representations: 7450.4, 7,450.4, 7450, 7,450, ~7451
      if (!calculatorCall && searchCall && /7[,.]?450/i.test(state.finalAnswer.replaceAll(",", ""))) {
        return { status: "partial", points: 1, summary: "Computed the right answer mentally after searching." };
      }

      return { status: "fail", points: 0, summary: "Did not preserve the exact searched value across tool calls." };
    }
  }
];

export const CATEGORY_LABELS: Record<BenchmarkCategory, string> = {
  A: "Quick Lookups",
  B: "Precision",
  C: "Multi-Tool",
  D: "Judgment",
  E: "Resilience"
};

export type ScenarioDisplayDetail = {
  successCase: string;
  failureCase: string;
};

export const SCENARIO_DISPLAY_DETAILS: Record<string, ScenarioDisplayDetail> = {
  "TC-01": { successCase: "Calls get_weather for Berlin, avoids web_search.", failureCase: "Uses web_search, calls multiple tools, or answers from memory." },
  "TC-02": { successCase: "Calls only get_stock_price with ticker AAPL.", failureCase: "Uses distractor tools or answers without a stock lookup." },
  "TC-03": { successCase: "Answers 'Paris' directly with zero tool calls.", failureCase: "Calls web_search or any tool for common knowledge." },
  "TC-04": { successCase: "Requests Tokyo weather with units=fahrenheit.", failureCase: "Ignores the Fahrenheit instruction or omits the parameter." },
  "TC-05": { successCase: "Creates event for 2026-03-23 at 09:30, 30min, with Alex and Jamie.", failureCase: "Misparses 'next Monday' or drops duration/attendees." },
  "TC-06": { successCase: "Makes two translate_text calls — one Spanish, one Japanese.", failureCase: "Crams both into one call or only translates one language." },
  "TC-07": { successCase: "Looks up Sarah's contact, then emails the correct address.", failureCase: "Fabricates Sarah's email or skips the contact lookup." },
  "TC-08": { successCase: "Calls get_weather AND get_stock_price (ideally parallel).", failureCase: "Misses one of the two requests." },
  "TC-09": { successCase: "Checks weather → sees rain → sets reminder with correct datetime.", failureCase: "Sets reminder without checking weather, or wrong datetime." },
  "TC-10": { successCase: "Answers $60 directly with no calculator call.", failureCase: "Uses calculator for 5 × 12 or gets the wrong answer." },
  "TC-11": { successCase: "Explains no delete tool exists, suggests alternatives.", failureCase: "Hallucinates a delete action or misuses send_email." },
  "TC-12": { successCase: "All 4 steps: search → read → contact → email with correct data.", failureCase: "Invents the total or the manager's email." },
  "TC-13": { successCase: "Retries search with broader query or asks for clarification.", failureCase: "Gives up silently or invents a file." },
  "TC-14": { successCase: "Surfaces the error and suggests fallback or retry.", failureCase: "Hides the error and fabricates a stock price." },
  "TC-15": { successCase: "Uses exact 372,520 from search in the calculator.", failureCase: "Skips search or uses a rounded/memorized number." },
};

export type ModelScenarioResult = {
  scenarioId: string;
  status: ScenarioStatus;
  points: 0 | 1 | 2;
  summary: string;
  note?: string;
  rawLog: string;
  latencyMs?: number;
  totalTurns?: number;
};

export type CategoryScore = {
  category: BenchmarkCategory;
  label: string;
  earned: number;
  max: number;
  percent: number;
};

export type ModelScoreSummary = {
  scenarioResults: ModelScenarioResult[];
  categoryScores: CategoryScore[];
  finalScore: number;
  totalPoints: number;
  maxPoints: number;
  rating: string;
  avgLatencyMs: number;
  totalLatencyMs: number;
  avgTurns: number;
};

function ratingForScore(score: number): string {
  if (score >= 90) {
    return "★★★★★ Excellent";
  }

  if (score >= 75) {
    return "★★★★ Good";
  }

  if (score >= 60) {
    return "★★★ Adequate";
  }

  if (score >= 40) {
    return "★★ Weak";
  }

  return "★ Poor";
}

export function scoreModelResults(results: ModelScenarioResult[], scenarioPool?: ScenarioDefinition[]): ModelScoreSummary {
  const pool = scenarioPool ?? SCENARIOS;

  const categoryScores = (Object.keys(CATEGORY_LABELS) as BenchmarkCategory[]).map((category) => {
    const scenariosInCategory = pool.filter((s) => s.category === category);
    const max = scenariosInCategory.length * 2;
    const earned = results
      .filter((result) => scenariosInCategory.some((s) => s.id === result.scenarioId))
      .reduce((sum, result) => sum + result.points, 0);

    return {
      category,
      label: CATEGORY_LABELS[category],
      earned,
      max,
      percent: max > 0 ? Math.round((earned / max) * 100) : 0
    };
  });

  const finalScore = Math.round(
    categoryScores.reduce((sum, categoryScore) => sum + categoryScore.percent, 0) / categoryScores.length
  );
  const totalPoints = results.reduce((sum, result) => sum + result.points, 0);

  const latencies = results.map((r) => r.latencyMs ?? 0).filter((l) => l > 0);
  const avgLatencyMs = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  const totalLatencyMs = latencies.reduce((a, b) => a + b, 0);
  const turns = results.map((r) => r.totalTurns ?? 0).filter((t) => t > 0);
  const avgTurns = turns.length > 0 ? Math.round((turns.reduce((a, b) => a + b, 0) / turns.length) * 10) / 10 : 0;

  return {
    scenarioResults: results,
    categoryScores,
    finalScore,
    totalPoints,
    maxPoints: SCENARIOS.length * 2,
    rating: ratingForScore(finalScore),
    avgLatencyMs,
    totalLatencyMs,
    avgTurns
  };
}
