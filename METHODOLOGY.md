# ToolCall-15 Methodology

**Version 1.0 — March 2026**
**Created for reproducible, visual LLM comparison**

---

## Why This Test Suite Exists

Most tool-calling benchmarks are academic, opaque, and impossible to demonstrate visually. ToolCall-15 is designed for a different purpose: to produce clear, comparable, screencast-friendly results that any viewer can understand and verify for themselves.

Every scenario in this suite is hand-picked to test a distinct, real-world failure mode. There are no filler tests. Each one exists because models actually diverge on it.

---

## Design Principles

1. **Reproducible.** Every scenario specifies the exact system prompt, tool definitions, user message, and expected behavior. Anyone can re-run these tests and get comparable results.
2. **Visual.** Each scenario produces a clear pass/fail moment that is obvious on screen — no spreadsheets required.
3. **Balanced.** The suite covers 5 categories with 3 scenarios each, preventing any single skill from dominating the score.
4. **Versioned.** The suite is frozen per version. When models improve, we release a new version rather than changing old tests.
5. **Honest.** We acknowledge what this suite does NOT measure (see Limitations).

---

## Test Environment Setup

### System Prompt (used for ALL scenarios)

```
You are a helpful assistant with access to the tools provided.

Rules:
- Use a tool ONLY when it is necessary to fulfill the user's request.
- If you can answer directly from your own knowledge, do so without calling a tool.
- If a tool call fails, explain the failure and suggest an alternative approach.
- Never invent information that a tool should provide.
```

### Tool Definitions (universal toolkit)

All 15 scenarios draw from the same pool of 12 tools. Models receive the full set every time, which tests their ability to ignore irrelevant options.

```json
[
  {
    "name": "web_search",
    "description": "Search the web for current information",
    "parameters": {
      "query": { "type": "string", "required": true },
      "max_results": { "type": "integer", "default": 5 }
    }
  },
  {
    "name": "get_weather",
    "description": "Get current weather for a specific location",
    "parameters": {
      "location": { "type": "string", "required": true },
      "units": { "type": "string", "enum": ["celsius", "fahrenheit"], "default": "celsius" }
    }
  },
  {
    "name": "calculator",
    "description": "Perform mathematical calculations",
    "parameters": {
      "expression": { "type": "string", "required": true }
    }
  },
  {
    "name": "send_email",
    "description": "Send an email to a recipient",
    "parameters": {
      "to": { "type": "string", "required": true },
      "subject": { "type": "string", "required": true },
      "body": { "type": "string", "required": true },
      "attachments": { "type": "array", "items": "string", "default": [] }
    }
  },
  {
    "name": "search_files",
    "description": "Search for files by name or content",
    "parameters": {
      "query": { "type": "string", "required": true },
      "file_type": { "type": "string", "enum": ["pdf", "docx", "xlsx", "any"], "default": "any" }
    }
  },
  {
    "name": "read_file",
    "description": "Read the contents of a specific file",
    "parameters": {
      "file_id": { "type": "string", "required": true }
    }
  },
  {
    "name": "create_calendar_event",
    "description": "Create a new calendar event",
    "parameters": {
      "title": { "type": "string", "required": true },
      "date": { "type": "string", "format": "YYYY-MM-DD", "required": true },
      "time": { "type": "string", "format": "HH:MM", "required": true },
      "duration_minutes": { "type": "integer", "default": 60 },
      "attendees": { "type": "array", "items": "string", "default": [] }
    }
  },
  {
    "name": "get_contacts",
    "description": "Look up contacts by name or group",
    "parameters": {
      "query": { "type": "string", "required": true }
    }
  },
  {
    "name": "translate_text",
    "description": "Translate text from one language to another",
    "parameters": {
      "text": { "type": "string", "required": true },
      "source_language": { "type": "string", "required": true },
      "target_language": { "type": "string", "required": true }
    }
  },
  {
    "name": "get_stock_price",
    "description": "Get the current stock price for a ticker symbol",
    "parameters": {
      "ticker": { "type": "string", "required": true }
    }
  },
  {
    "name": "set_reminder",
    "description": "Set a reminder for a future time",
    "parameters": {
      "message": { "type": "string", "required": true },
      "datetime": { "type": "string", "format": "ISO 8601", "required": true }
    }
  },
  {
    "name": "run_code",
    "description": "Execute a code snippet and return the output",
    "parameters": {
      "language": { "type": "string", "enum": ["python", "javascript"], "required": true },
      "code": { "type": "string", "required": true }
    }
  }
]
```

---

## Category A: Tool Selection (Can it pick the right tool?)

### TC-01: Direct Specialist Match

**User message:** "What's the weather like in Berlin right now?"

**Expected behavior:**
- Call `get_weather` with `location: "Berlin"` (or "Berlin, Germany")
- Do NOT call `web_search`

**Mocked response:**
```json
{ "location": "Berlin", "temperature": 8, "units": "celsius", "condition": "Overcast", "humidity": 72 }
```

**What this tests:** When a specialized tool exists, does the model use it instead of a general-purpose fallback like `web_search`?

**Scoring:**
| Result | Score |
|---|---|
| Calls `get_weather` with Berlin | ✅ Full pass |
| Calls `web_search` for Berlin weather | ⚠️ Half credit — functional but suboptimal |
| Calls both | ❌ Fail — unnecessary redundancy |
| Answers without any tool call | ❌ Fail — fabricated data |

---

### TC-02: Distractor Resistance

**User message:** "What is the current price of AAPL stock?"

**Expected behavior:**
- Call `get_stock_price` with `ticker: "AAPL"`
- Do NOT call `web_search`, `calculator`, or any other tool

**Mocked response:**
```json
{ "ticker": "AAPL", "price": 187.42, "currency": "USD", "change": "+1.23", "change_percent": "+0.66%" }
```

**What this tests:** 12 tools are available. Can the model resist distractors and pick the one correct tool?

**Scoring:**
| Result | Score |
|---|---|
| Calls only `get_stock_price({ ticker: "AAPL" })` | ✅ Full pass |
| Calls `get_stock_price` but also `web_search` | ⚠️ Half credit |
| Calls `web_search` instead | ❌ Fail |
| Answers from memory without calling anything | ❌ Fail |

---

### TC-03: Implicit Tool Need

**User message:** "I need to let Sarah know the meeting moved to 3pm."

**Expected behavior:**
- Call `get_contacts` with `query: "Sarah"` first
- Then call `send_email` with the looked-up address

**Mocked response (step 1):**
```json
{ "results": [{ "name": "Sarah Chen", "email": "sarah.chen@company.com" }] }
```

**Mocked response (step 2):**
```json
{ "status": "sent", "message_id": "msg_8821" }
```

**What this tests:** The user didn't say "send an email" or "look up Sarah's contact." Can the model infer the tool chain from natural intent?

**Scoring:**
| Result | Score |
|---|---|
| Calls `get_contacts` → `send_email` with correct address | ✅ Full pass |
| Calls `send_email` with fabricated address | ❌ Fail — hallucinated parameter |
| Asks user for Sarah's email | ⚠️ Half credit — safe but passive |
| Does nothing, just gives advice | ❌ Fail |

---

## Category B: Parameter Precision (Does it pass the right arguments?)

### TC-04: Unit Handling

**User message:** "What's the temperature in Tokyo in Fahrenheit?"

**Expected behavior:**
- Call `get_weather` with `location: "Tokyo"` AND `units: "fahrenheit"`

**Mocked response:**
```json
{ "location": "Tokyo", "temperature": 64, "units": "fahrenheit", "condition": "Clear" }
```

**What this tests:** The user explicitly requested Fahrenheit. Does the model pass the optional parameter?

**Scoring:**
| Result | Score |
|---|---|
| `get_weather({ location: "Tokyo", units: "fahrenheit" })` | ✅ Full pass |
| `get_weather({ location: "Tokyo" })` then manually converts | ⚠️ Half credit |
| `get_weather({ location: "Tokyo" })` and reports Celsius | ❌ Fail — ignored instruction |

---

### TC-05: Date and Time Parsing

**User message:** "Schedule a team standup for next Monday at 9:30am, 30 minutes, with Alex and Jamie."

**Expected behavior (assuming today is 2026-03-20, Friday):**
- Call `create_calendar_event` with:
  - `title`: any reasonable title (e.g. "Team Standup")
  - `date`: "2026-03-23"
  - `time`: "09:30"
  - `duration_minutes`: 30
  - `attendees`: should include "Alex" and "Jamie" (may call `get_contacts` first)

**Mocked response:**
```json
{ "event_id": "evt_4412", "status": "created", "title": "Team Standup", "date": "2026-03-23" }
```

**What this tests:** Relative date parsing ("next Monday"), time formatting, optional parameter usage, and whether it attempts contact lookup.

**Scoring:**
| Result | Score |
|---|---|
| Correct date + time + duration + attendees | ✅ Full pass |
| Correct date but missing duration or attendees | ⚠️ Half credit |
| Wrong date (e.g. this Monday instead of next) | ❌ Fail |
| Doesn't create event, just tells user how to | ❌ Fail |

---

### TC-06: Multi-Value Extraction

**User message:** "Translate 'Where is the nearest hospital?' from English to both Spanish and Japanese."

**Expected behavior:**
- Call `translate_text` twice:
  - `{ text: "Where is the nearest hospital?", source_language: "English", target_language: "Spanish" }`
  - `{ text: "Where is the nearest hospital?", source_language: "English", target_language: "Japanese" }`
- Calls can be parallel or sequential

**Mocked responses:**
```json
{ "translated": "¿Dónde está el hospital más cercano?" }
{ "translated": "最寄りの病院はどこですか？" }
```

**What this tests:** "Both Spanish and Japanese" requires two separate tool calls. Does the model handle one-to-many correctly?

**Scoring:**
| Result | Score |
|---|---|
| Two separate `translate_text` calls with correct params | ✅ Full pass |
| One call with both languages crammed into one parameter | ❌ Fail — schema violation |
| Only translates to one language | ❌ Fail — incomplete |
| Translates from memory without tool calls | ❌ Fail — tool was available |

---

## Category C: Multi-Step Chains (Can it thread data across steps?)

### TC-07: Search → Read → Act

**User message:** "Find the Q3 budget report and email the total to my manager."

**Expected chain:**
1. `search_files({ query: "Q3 budget report" })`
2. `read_file({ file_id: "file_091" })` — using ID from step 1
3. `get_contacts({ query: "manager" })` — to get email address
4. `send_email({ to: "...", subject: "...", body: "..." })` — with total from step 2

**Mocked responses:**
```json
Step 1: { "results": [{ "file_id": "file_091", "name": "Q3_Budget_Report_2025.xlsx" }] }
Step 2: { "content": "Department budgets: Engineering $2.1M, Marketing $800K, Sales $1.5M. Total: $4.4M" }
Step 3: { "results": [{ "name": "Jordan Park", "email": "jordan.park@company.com", "role": "manager" }] }
Step 4: { "status": "sent" }
```

**What this tests:** Four-step chain where each step depends on the previous. The model must thread `file_id` from step 1 into step 2, extract data from step 2 into step 4, and resolve the contact in step 3.

**Scoring:**
| Result | Score |
|---|---|
| Completes all 4 steps with correct data threading | ✅ Full pass |
| Gets 3 of 4 steps right | ⚠️ 75% credit |
| Skips `read_file` and invents the total | ❌ Fail — hallucinated data |
| Skips `get_contacts` and invents email | ❌ Fail — hallucinated parameter |

---

### TC-08: Conditional Branching

**User message:** "Check the weather in Paris. If it's raining, remind me to bring an umbrella tomorrow at 8am."

**Expected chain:**
1. `get_weather({ location: "Paris" })`
2. IF condition contains rain → `set_reminder({ message: "Bring an umbrella", datetime: "2026-03-21T08:00:00" })`
2. IF condition is NOT rain → No second tool call, just report weather

**Mocked response (rainy version):**
```json
Step 1: { "location": "Paris", "temperature": 11, "condition": "Light rain", "humidity": 89 }
Step 2: { "reminder_id": "rem_553", "status": "set" }
```

**What this tests:** Can the model make a conditional decision based on tool output? This requires reading the result and branching logic, not just chaining blindly.

**Scoring:**
| Result | Score |
|---|---|
| Checks weather → sees rain → sets reminder with correct datetime | ✅ Full pass |
| Checks weather → sets reminder regardless of condition | ❌ Fail — no conditional reasoning |
| Sets reminder without checking weather first | ❌ Fail — wrong order |
| Checks weather → sees rain → asks user instead of setting reminder | ⚠️ Half credit — overly cautious |

---

### TC-09: Parallel Independence

**User message:** "What's the weather in London and the stock price of MSFT?"

**Expected behavior:**
- Call `get_weather({ location: "London" })` AND `get_stock_price({ ticker: "MSFT" })`
- These are independent and should ideally be called in parallel (or at minimum, both must be called)

**Mocked responses:**
```json
{ "location": "London", "temperature": 12, "condition": "Cloudy" }
{ "ticker": "MSFT", "price": 412.78, "currency": "USD" }
```

**What this tests:** Two independent sub-tasks in one message. Does the model recognize they're unrelated and handle both? Bonus: does it call them in parallel?

**Scoring:**
| Result | Score |
|---|---|
| Both tools called (parallel) | ✅ Full pass + parallel bonus |
| Both tools called (sequential) | ✅ Full pass |
| Only one tool called | ❌ Fail — missed half the request |
| `web_search` used instead of specialized tools | ⚠️ Half credit |

---

## Category D: Restraint & Refusal (Does it know when NOT to act?)

### TC-10: Trivial Knowledge — No Tool Needed

**User message:** "What year did World War II end?"

**Expected behavior:**
- Answer directly: 1945
- Do NOT call any tool

**What this tests:** The `web_search` and `calculator` tools are available. Does the model resist using them for basic knowledge?

**Scoring:**
| Result | Score |
|---|---|
| Answers "1945" with no tool call | ✅ Full pass |
| Calls `web_search` then answers correctly | ❌ Fail — unnecessary tool use |
| Calls `calculator` | ❌ Fail — nonsensical tool use |

---

### TC-11: Simple Math — No Calculator Needed

**User message:** "What is 15% of 200?"

**Expected behavior:**
- Answer directly: 30
- Do NOT call `calculator`

**What this tests:** The calculator tool is tempting but completely unnecessary. Tests whether the model uses tools as a crutch.

**Scoring:**
| Result | Score |
|---|---|
| Answers "30" with no tool call | ✅ Full pass |
| Calls `calculator("0.15 * 200")` then answers | ⚠️ Half credit — correct but wasteful |
| Calls `web_search` for this | ❌ Fail |

---

### TC-12: Impossible Request — Should Refuse Gracefully

**User message:** "Delete all my emails from last month."

**Expected behavior:**
- The available tools include `send_email` but NOT a "delete email" tool
- Model should explain it cannot delete emails with available tools
- Do NOT call `send_email` or any other tool as a workaround

**What this tests:** When no suitable tool exists, does the model refuse gracefully or hallucinate a capability?

**Scoring:**
| Result | Score |
|---|---|
| Explains no delete tool is available, suggests alternatives | ✅ Full pass |
| Calls `send_email` or any other tool as a workaround | ❌ Fail — misused tool |
| Hallucinates a `delete_email` tool that doesn't exist | ❌ Fail — tool hallucination |
| Silently does nothing without explaining | ❌ Fail — poor UX |

---

## Category E: Error Recovery (What happens when things go wrong?)

### TC-13: Empty Results — Retry or Clarify

**User message:** "Find the Johnson proposal document."

**Expected chain:**
1. `search_files({ query: "Johnson proposal" })`
2. After empty result → either retry with broader query OR ask user for clarification

**Mocked responses:**
```json
Step 1: { "results": [] }
Step 2 (if retry): { "results": [{ "file_id": "file_117", "name": "Johnson_Project_Proposal_v2.docx" }] }
```

**What this tests:** Step 1 returns nothing. Does the model give up, hallucinate a file, or intelligently adapt?

**Scoring:**
| Result | Score |
|---|---|
| Retries with broader search (e.g. "Johnson") → succeeds | ✅ Full pass |
| Informs user of no results and asks for clarification | ✅ Full pass (alternative valid path) |
| Invents a file that wasn't in results | ❌ Fail — hallucination |
| Silently gives up | ❌ Fail |

---

### TC-14: Malformed Response — Graceful Handling

**User message:** "What's Apple's stock price?"

**Expected chain:**
1. `get_stock_price({ ticker: "AAPL" })`
2. Receives an error response → should inform user and suggest alternatives

**Mocked response:**
```json
{ "error": "Service temporarily unavailable. Rate limit exceeded." }
```

**What this tests:** The tool returns an error instead of data. Does the model surface the error clearly, or does it pretend everything is fine?

**Scoring:**
| Result | Score |
|---|---|
| Explains the service is unavailable, offers to try again or use `web_search` as fallback | ✅ Full pass |
| Retries `get_stock_price` once, then falls back gracefully | ✅ Full pass |
| Ignores the error and makes up a stock price | ❌ Fail — dangerous hallucination |
| Calls `web_search` as fallback without acknowledging the error | ⚠️ Half credit |

---

### TC-15: Conflicting Information — Integrity Under Pressure

**User message:** "Search for the population of Iceland and calculate what 2% of it would be."

**Expected chain:**
1. `web_search({ query: "population of Iceland" })`
2. `calculator({ expression: "372520 * 0.02" })` — using the number from step 1

**Mocked response (step 1):**
```json
{ "results": [{ "snippet": "Iceland has a population of approximately 372,520 as of 2025." }] }
```

**Mocked response (step 2):**
```json
{ "result": 7450.4 }
```

**What this tests:** The model must use the ACTUAL number from the search result in the calculation, not a memorized or rounded number. Tests data integrity across tool calls.

**Scoring:**
| Result | Score |
|---|---|
| Uses 372520 (or 372,520) from search in calculator | ✅ Full pass |
| Uses a rounded number like 370000 from memory | ❌ Fail — didn't use tool output |
| Calculates mentally without calling calculator | ⚠️ Half credit — if answer is correct |
| Calls calculator with a memorized population number without searching | ❌ Fail — skipped required step |

---

## Scoring Summary

### Per-Scenario Scoring

| Symbol | Meaning | Points |
|---|---|---|
| ✅ | Full pass | 2 |
| ⚠️ | Half credit | 1 |
| ❌ | Fail | 0 |

### Category Weights

| Category | Tests | Max Points | Weight |
|---|---|---|---|
| A — Tool Selection | TC-01, TC-02, TC-03 | 6 | 20% |
| B — Parameter Precision | TC-04, TC-05, TC-06 | 6 | 20% |
| C — Multi-Step Chains | TC-07, TC-08, TC-09 | 6 | 20% |
| D — Restraint & Refusal | TC-10, TC-11, TC-12 | 6 | 20% |
| E — Error Recovery | TC-13, TC-14, TC-15 | 6 | 20% |

### Final Score Calculation

```
Category Score = (points earned / 6) × 100
Final Score    = average of all 5 category scores
```

**Rating Tiers:**

| Score | Rating | Meaning |
|---|---|---|
| 90–100 | ★★★★★ Excellent | Production-ready tool use |
| 75–89 | ★★★★ Good | Reliable with minor gaps |
| 60–74 | ★★★ Adequate | Works for simple cases, struggles with complexity |
| 40–59 | ★★ Weak | Frequent errors, needs supervision |
| 0–39 | ★ Poor | Not suitable for tool-use applications |

---

## How to Run a Comparison

### Pre-Recording Checklist

1. Use the SAME system prompt for every model (copy-paste from above)
2. Use the SAME tool definitions for every model
3. Run scenarios in the SAME order
4. Use temperature 0 (or the lowest available) for reproducibility
5. Record the FULL response including any reasoning/thinking tokens
6. Do NOT cherry-pick runs — use the first attempt for each scenario

### Recommended Recording Format

For each model, record a screen showing:
- The user message being sent
- The tool call(s) the model makes (highlight function name + parameters)
- The mocked response being injected
- The model's final answer
- A pass/fail verdict overlay

### Side-by-Side Template

```
┌─────────────── Model A ───────────────┬─────────────── Model B ───────────────┐
│ TC-01: Weather in Berlin              │ TC-01: Weather in Berlin              │
│ → get_weather({ location: "Berlin" }) │ → web_search("Berlin weather")        │
│ Result: ✅ Full pass                  │ Result: ⚠️ Half credit               │
├───────────────────────────────────────┼───────────────────────────────────────┤
│ TC-02: AAPL Stock Price               │ TC-02: AAPL Stock Price               │
│ → get_stock_price({ ticker: "AAPL" }) │ → get_stock_price({ ticker: "AAPL" }) │
│ Result: ✅ Full pass                  │ Result: ✅ Full pass                  │
└───────────────────────────────────────┴───────────────────────────────────────┘
```

---

## Limitations & Honesty Statement

This test suite is NOT:
- A statistically rigorous benchmark (n=1 per scenario unless you run multiple times)
- A replacement for academic evaluations like BFCL or ToolComp
- Comprehensive — 15 scenarios cannot cover all tool-use patterns
- A measure of general intelligence — only tool-calling behavior

This test suite IS:
- A standardized, reproducible comparison framework
- Designed for visual demonstration and public comparison
- Transparent about methodology — every prompt, tool, and expected answer is published
- Focused on the failure modes that matter most in real-world applications

When publishing results, we recommend:
- Always link to this full test suite so viewers can verify methodology
- Show the raw tool calls, not just pass/fail — let viewers judge for themselves
- Run each test at least 3 times and report whether results were consistent
- Disclose the model version, API date, and any model-specific settings used

---

## Changelog

**v1.0 (March 2026):** Initial release with 15 scenarios across 5 categories.

---

## License

This methodology is part of the ToolCall-15 repository and is released under the MIT License. See `LICENSE` in the repository root.
