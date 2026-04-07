// Memory & Retrieval Benchmark Suite
// Tests: recall accuracy, query formulation, synthesis, hallucination resistance, contradiction handling

export { BENCHMARK_REFERENCE_DATE, BENCHMARK_REFERENCE_DAY } from "./benchmark";
export { scoreModelResults } from "./benchmark";
import type { ScenarioDefinition, ScenarioState, ToolCallRecord, BenchmarkCategory, ScenarioDisplayDetail } from "./benchmark";

// ── System Prompt ──

export const MEMORY_SYSTEM_PROMPT = `You are an AI assistant with access to a memory system, knowledge base, and document store.

Rules:
- Use memory_search to recall previously stored facts before answering from memory.
- Use retrieve_context or search_knowledge when the user asks about documents or knowledge base content.
- Use memory_store to save important facts the user shares for future reference.
- When retrieved context doesn't contain the answer, say so — do NOT fabricate information.
- When citing information, reference the source document or memory entry.
- If new information contradicts stored memory, flag the contradiction and ask for clarification.
- Summarize long retrieved content before presenting it.`;

// ── Tool Definitions ──

type MemoryToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean } };
};

export const MEMORY_TOOLS: MemoryToolDefinition[] = [
  { type: "function", function: { name: "memory_store", description: "Save a fact, preference, or note to persistent memory for future recall", parameters: { type: "object", properties: { key: { type: "string" }, content: { type: "string" }, category: { type: "string", enum: ["fact", "preference", "context", "decision"] }, importance: { type: "string", enum: ["low", "medium", "high"] } }, required: ["content"], additionalProperties: false } } },
  { type: "function", function: { name: "memory_search", description: "Search stored memories by query. Returns matching memory entries.", parameters: { type: "object", properties: { query: { type: "string" }, category: { type: "string" }, limit: { type: "integer", default: 5 } }, required: ["query"], additionalProperties: false } } },
  { type: "function", function: { name: "memory_delete", description: "Delete a stored memory by its key", parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"], additionalProperties: false } } },
  { type: "function", function: { name: "retrieve_context", description: "Retrieve relevant text chunks from the knowledge base using semantic search", parameters: { type: "object", properties: { query: { type: "string" }, collection: { type: "string", default: "default" }, top_k: { type: "integer", default: 3 } }, required: ["query"], additionalProperties: false } } },
  { type: "function", function: { name: "search_knowledge", description: "Search documents and wiki articles by keyword or topic", parameters: { type: "object", properties: { query: { type: "string" }, source: { type: "string", enum: ["docs", "wiki", "tickets", "all"] }, limit: { type: "integer", default: 5 } }, required: ["query"], additionalProperties: false } } },
  { type: "function", function: { name: "read_document", description: "Read the full contents of a document by its ID", parameters: { type: "object", properties: { doc_id: { type: "string" }, section: { type: "string" } }, required: ["doc_id"], additionalProperties: false } } },
  { type: "function", function: { name: "summarize_text", description: "Condense a long text into a shorter summary", parameters: { type: "object", properties: { text: { type: "string" }, max_length: { type: "integer", default: 200 }, style: { type: "string", enum: ["brief", "detailed", "bullet_points"] } }, required: ["text"], additionalProperties: false } } },
  { type: "function", function: { name: "cite_sources", description: "Generate structured citations from retrieved documents", parameters: { type: "object", properties: { claims: { type: "array", items: { type: "string" } }, sources: { type: "array", items: { type: "string" } } }, required: ["claims", "sources"], additionalProperties: false } } },
  { type: "function", function: { name: "embed_text", description: "Generate a vector embedding for text (for similarity search)", parameters: { type: "object", properties: { text: { type: "string" }, model: { type: "string", default: "default" } }, required: ["text"], additionalProperties: false } } },
  { type: "function", function: { name: "compare_facts", description: "Compare two pieces of information and identify contradictions or consistency", parameters: { type: "object", properties: { fact_a: { type: "string" }, fact_b: { type: "string" }, context: { type: "string" } }, required: ["fact_a", "fact_b"], additionalProperties: false } } },
  { type: "function", function: { name: "session_history", description: "Retrieve conversation history from past sessions with this user", parameters: { type: "object", properties: { query: { type: "string" }, sessions_back: { type: "integer", default: 5 } }, required: ["query"], additionalProperties: false } } },
  { type: "function", function: { name: "user_profile", description: "Read or update the user's profile, preferences, and stored context", parameters: { type: "object", properties: { action: { type: "string", enum: ["read", "update"] }, field: { type: "string" }, value: { type: "string" } }, required: ["action"], additionalProperties: false } } },
];

// ── Helpers ──

function asString(v: unknown): string { return typeof v === "string" ? v : ""; }
function normalize(v: string): string { return v.trim().toLowerCase(); }
function includesText(v: unknown, expected: string): boolean { return asString(v).toLowerCase().includes(expected.toLowerCase()); }
function hasToolCall(state: ScenarioState, name: string, pred?: (c: ToolCallRecord) => boolean): boolean { return state.toolCalls.filter(c => c.name === name).some(c => pred ? pred(c) : true); }
function firstCall(state: ScenarioState, name: string): ToolCallRecord | undefined { return state.toolCalls.find(c => c.name === name); }

function genericFallback(call: ToolCallRecord): unknown {
  return { error: `Tool ${call.name} is not relevant for this scenario.` };
}

// ── Scenarios ──

export const MEMORY_SCENARIOS: ScenarioDefinition[] = [
  // ═══ A: Recall & Retrieval ═══
  {
    id: "MR-01",
    title: "Simple Fact Recall",
    category: "A",
    userMessage: "What's our company's annual revenue? I told you about this before.",
    description: "Search memory for a previously stored fact instead of guessing.",
    handleToolCall(_s, call) {
      if (call.name === "memory_search") return { results: [{ key: "company_revenue", content: "Annual revenue is $12.4M as of Q4 2025.", category: "fact", stored_at: "2026-03-15" }] };
      return genericFallback(call);
    },
    evaluate(state) {
      const searched = hasToolCall(state, "memory_search", c => includesText(c.arguments.query, "revenue"));
      if (searched && state.finalAnswer.includes("12.4")) return { status: "pass", points: 2, summary: "Searched memory and quoted correct revenue." };
      if (!searched && state.finalAnswer.includes("12.4")) return { status: "fail", points: 0, summary: "Got the number right but didn't use memory_search — hallucinated." };
      if (searched) return { status: "partial", points: 1, summary: "Searched memory but didn't report the figure clearly." };
      return { status: "fail", points: 0, summary: "Did not search memory for previously stored fact." };
    }
  },
  {
    id: "MR-02",
    title: "Knowledge Base Lookup",
    category: "A",
    userMessage: "What does our refund policy say about digital products?",
    description: "Retrieve from knowledge base, not from general knowledge.",
    handleToolCall(_s, call) {
      if (call.name === "retrieve_context" || call.name === "search_knowledge") return { results: [{ doc_id: "doc_policy_01", title: "Refund Policy v3", content: "Digital products are non-refundable after download. Exceptions: defective files or accidental purchases within 24 hours. Contact support@company.com for exception requests.", relevance: 0.94 }] };
      if (call.name === "read_document") return { content: "Digital products are non-refundable after download. Exceptions: defective files or accidental purchases within 24 hours." };
      return genericFallback(call);
    },
    evaluate(state) {
      const retrieved = hasToolCall(state, "retrieve_context") || hasToolCall(state, "search_knowledge");
      const mentionsPolicy = includesText(state.finalAnswer, "non-refundable") || includesText(state.finalAnswer, "24 hours");
      if (retrieved && mentionsPolicy) return { status: "pass", points: 2, summary: "Retrieved from KB and accurately reported the policy." };
      if (retrieved) return { status: "partial", points: 1, summary: "Retrieved context but didn't summarize policy clearly." };
      if (mentionsPolicy) return { status: "fail", points: 0, summary: "Answered correctly but didn't use retrieval tools — may have guessed." };
      return { status: "fail", points: 0, summary: "Did not retrieve from knowledge base." };
    }
  },
  {
    id: "MR-03",
    title: "Session History Lookup",
    category: "A",
    userMessage: "What project were we discussing in our last conversation?",
    description: "Search past session history to recall previous conversation context.",
    handleToolCall(_s, call) {
      if (call.name === "session_history") return { results: [{ session_id: "sess_042", date: "2026-03-19", summary: "Discussed the Atlas migration project — user wanted to move from PostgreSQL to MongoDB. Decided on a phased approach starting with the user service." }] };
      if (call.name === "memory_search") return { results: [{ key: "current_project", content: "Working on Atlas migration — PostgreSQL to MongoDB", category: "context" }] };
      return genericFallback(call);
    },
    evaluate(state) {
      const searched = hasToolCall(state, "session_history") || hasToolCall(state, "memory_search");
      const mentionsProject = includesText(state.finalAnswer, "atlas") || includesText(state.finalAnswer, "migration");
      if (searched && mentionsProject) return { status: "pass", points: 2, summary: "Looked up session history and recalled the Atlas migration project." };
      if (searched) return { status: "partial", points: 1, summary: "Searched history but response was vague." };
      return { status: "fail", points: 0, summary: "Did not search session history or memory." };
    }
  },

  // ═══ B: Memory Storage ═══
  {
    id: "MR-04",
    title: "Store Important Fact",
    category: "B",
    userMessage: "Just so you know, our main competitor is Acme Corp and they just raised $50M in Series C funding.",
    description: "Recognize important info and store it to memory proactively.",
    handleToolCall(_s, call) {
      if (call.name === "memory_store") return { status: "stored", key: call.arguments.key ?? "competitor_funding" };
      return genericFallback(call);
    },
    evaluate(state) {
      const stored = hasToolCall(state, "memory_store", c => (includesText(c.arguments.content, "acme") || includesText(c.arguments.content, "50m") || includesText(c.arguments.content, "series c")));
      if (stored) return { status: "pass", points: 2, summary: "Stored competitor info with key details (Acme, $50M, Series C)." };
      if (hasToolCall(state, "memory_store")) return { status: "partial", points: 1, summary: "Stored something but missed key details." };
      return { status: "fail", points: 0, summary: "Did not store the competitor intelligence to memory." };
    }
  },
  {
    id: "MR-05",
    title: "Don't Store Trivia",
    category: "B",
    userMessage: "Nice weather today, isn't it? Anyway, what's on my agenda?",
    description: "NOT everything should be memorized — weather chat is not worth storing.",
    handleToolCall(_s, call) {
      if (call.name === "memory_store") return { status: "stored", key: "weather_chat" };
      if (call.name === "memory_search" || call.name === "session_history") return { results: [{ key: "agenda_today", content: "10am: standup, 2pm: design review, 4pm: 1:1 with Sarah" }] };
      return genericFallback(call);
    },
    evaluate(state) {
      const storedWeather = hasToolCall(state, "memory_store", c => includesText(c.arguments.content, "weather"));
      const searchedAgenda = hasToolCall(state, "memory_search") || hasToolCall(state, "session_history");
      if (!storedWeather && searchedAgenda) return { status: "pass", points: 2, summary: "Ignored the small talk, searched for agenda — good judgment." };
      if (!storedWeather) return { status: "partial", points: 1, summary: "Correctly didn't store weather, but didn't search for agenda either." };
      return { status: "fail", points: 0, summary: "Stored trivial weather chat to memory — poor storage judgment." };
    }
  },
  {
    id: "MR-06",
    title: "Update User Profile",
    category: "B",
    userMessage: "I've moved to the London office now. Please update my location — I was previously in New York.",
    description: "Update the user profile with new info, replacing the old value.",
    handleToolCall(_s, call) {
      if (call.name === "user_profile" && normalize(asString(call.arguments.action)) === "update") return { status: "updated", field: call.arguments.field, old_value: "New York", new_value: call.arguments.value };
      if (call.name === "user_profile" && normalize(asString(call.arguments.action)) === "read") return { location: "New York", role: "Engineer", team: "Platform" };
      if (call.name === "memory_store") return { status: "stored", key: call.arguments.key ?? "location_update" };
      return genericFallback(call);
    },
    evaluate(state) {
      const updated = hasToolCall(state, "user_profile", c => normalize(asString(c.arguments.action)) === "update" && includesText(c.arguments.value ?? c.arguments.field, "london"));
      const stored = hasToolCall(state, "memory_store", c => includesText(c.arguments.content, "london"));
      if (updated) return { status: "pass", points: 2, summary: "Updated user profile location to London." };
      if (stored) return { status: "partial", points: 1, summary: "Stored the move to memory but didn't update the profile directly." };
      return { status: "fail", points: 0, summary: "Did not update location in profile or memory." };
    }
  },

  // ═══ C: Query & Synthesis ═══
  {
    id: "MR-07",
    title: "Multi-Doc Synthesis",
    category: "C",
    userMessage: "Give me a summary of our Q3 and Q4 performance. Pull from the reports.",
    description: "Retrieve multiple documents, synthesize into a coherent summary.",
    handleToolCall(state, call) {
      if (call.name === "search_knowledge" || call.name === "retrieve_context") {
        const q = asString(call.arguments.query).toLowerCase();
        if (q.includes("q3")) return { results: [{ doc_id: "report_q3", title: "Q3 2025 Report", content: "Q3 revenue: $3.1M (+12% QoQ). New customers: 48. Churn: 2.3%. Key win: Enterprise deal with TechCorp ($400K ARR)." }] };
        if (q.includes("q4")) return { results: [{ doc_id: "report_q4", title: "Q4 2025 Report", content: "Q4 revenue: $3.8M (+22% QoQ). New customers: 63. Churn: 1.8%. Key win: Government contract ($600K ARR). Launched v2.0." }] };
        return { results: [
          { doc_id: "report_q3", title: "Q3 2025 Report", content: "Q3 revenue: $3.1M (+12% QoQ). 48 new customers." },
          { doc_id: "report_q4", title: "Q4 2025 Report", content: "Q4 revenue: $3.8M (+22% QoQ). 63 new customers." }
        ]};
      }
      if (call.name === "read_document") {
        const id = asString(call.arguments.doc_id);
        if (id.includes("q3")) return { content: "Q3 revenue: $3.1M (+12% QoQ). New customers: 48. Churn: 2.3%." };
        if (id.includes("q4")) return { content: "Q4 revenue: $3.8M (+22% QoQ). New customers: 63. Churn: 1.8%." };
      }
      if (call.name === "summarize_text") return { summary: asString(call.arguments.text).slice(0, 200) };
      return genericFallback(call);
    },
    evaluate(state) {
      const retrieved = state.toolCalls.filter(c => c.name === "search_knowledge" || c.name === "retrieve_context" || c.name === "read_document");
      const mentionsBoth = includesText(state.finalAnswer, "3.1") && includesText(state.finalAnswer, "3.8");
      if (retrieved.length >= 1 && mentionsBoth) return { status: "pass", points: 2, summary: "Retrieved reports and synthesized both Q3 and Q4 data." };
      if (retrieved.length >= 1) return { status: "partial", points: 1, summary: "Retrieved but only covered one quarter." };
      return { status: "fail", points: 0, summary: "Did not retrieve quarterly reports." };
    }
  },
  {
    id: "MR-08",
    title: "Query Formulation",
    category: "C",
    userMessage: "Find everything we know about the TechCorp deal — pricing, timeline, stakeholders.",
    description: "Formulate a targeted retrieval query, not a vague one.",
    handleToolCall(_s, call) {
      if (call.name === "memory_search" || call.name === "search_knowledge" || call.name === "retrieve_context") {
        return { results: [
          { doc_id: "deal_techcorp", content: "TechCorp deal: $400K ARR, 3-year contract. Signed Q3 2025. Stakeholders: CTO Mike Chen, VP Eng Lisa Park. Includes premium support + custom integrations." },
          { doc_id: "notes_techcorp", content: "TechCorp timeline: POC in July, pilot August, full rollout September 2025. Renewal date: September 2028." }
        ]};
      }
      return genericFallback(call);
    },
    evaluate(state) {
      const searches = state.toolCalls.filter(c => ["memory_search", "search_knowledge", "retrieve_context"].includes(c.name));
      const hasTargeted = searches.some(c => includesText(c.arguments.query, "techcorp"));
      const answer = state.finalAnswer.toLowerCase();
      const mentionsDetails = (answer.includes("400k") || answer.includes("$400")) && (answer.includes("mike") || answer.includes("lisa") || answer.includes("stakeholder"));
      if (hasTargeted && mentionsDetails) return { status: "pass", points: 2, summary: "Targeted search for TechCorp, surfaced pricing + stakeholders." };
      if (hasTargeted) return { status: "partial", points: 1, summary: "Good query but didn't synthesize all requested dimensions." };
      return { status: "fail", points: 0, summary: "Search query was too vague or missing." };
    }
  },
  {
    id: "MR-09",
    title: "Cite Your Sources",
    category: "C",
    userMessage: "What are the key metrics from our last board presentation? Please cite which document each number comes from.",
    description: "Retrieve data AND provide citations to specific source documents.",
    handleToolCall(_s, call) {
      if (call.name === "search_knowledge" || call.name === "retrieve_context") return { results: [
        { doc_id: "board_deck_q4", title: "Q4 Board Deck", content: "ARR: $15.2M. Growth: 42% YoY. NRR: 118%. Customers: 340." },
        { doc_id: "finance_summary", title: "Finance Summary Dec 2025", content: "Burn rate: $890K/mo. Runway: 18 months. Gross margin: 78%." }
      ]};
      if (call.name === "cite_sources") return { citations: "Generated citations from provided claims and sources." };
      return genericFallback(call);
    },
    evaluate(state) {
      const retrieved = hasToolCall(state, "search_knowledge") || hasToolCall(state, "retrieve_context");
      const answer = state.finalAnswer.toLowerCase();
      const hasCitations = answer.includes("board deck") || answer.includes("finance summary") || answer.includes("doc_") || hasToolCall(state, "cite_sources");
      const hasNumbers = answer.includes("15.2") && (answer.includes("890") || answer.includes("78%"));
      if (retrieved && hasCitations && hasNumbers) return { status: "pass", points: 2, summary: "Retrieved, cited source documents, and reported key metrics." };
      if (retrieved && hasNumbers) return { status: "partial", points: 1, summary: "Correct numbers but missing source citations." };
      return { status: "fail", points: 0, summary: "Did not retrieve or cite sources properly." };
    }
  },

  // ═══ D: Hallucination Resistance ═══
  {
    id: "MR-10",
    title: "Admit When You Don't Know",
    category: "D",
    userMessage: "What was the conversion rate for our Facebook ad campaign last month?",
    description: "When memory/KB returns no results, admit it — don't make up numbers.",
    handleToolCall(_s, call) {
      if (call.name === "memory_search") return { results: [] };
      if (call.name === "search_knowledge" || call.name === "retrieve_context") return { results: [] };
      return genericFallback(call);
    },
    evaluate(state) {
      const searched = state.toolCalls.some(c => ["memory_search", "search_knowledge", "retrieve_context"].includes(c.name));
      const answer = state.finalAnswer.toLowerCase();
      const admits = answer.includes("don't have") || answer.includes("no data") || answer.includes("couldn't find") || answer.includes("not available") || answer.includes("no results");
      const fabricated = /\d+\.?\d*%/.test(state.finalAnswer) && !admits; // made up a percentage
      if (searched && admits && !fabricated) return { status: "pass", points: 2, summary: "Searched, found nothing, honestly said so." };
      if (searched && fabricated) return { status: "fail", points: 0, summary: "Searched but then fabricated a conversion rate." };
      if (!searched) return { status: "fail", points: 0, summary: "Didn't even search — answered from imagination." };
      return { status: "partial", points: 1, summary: "Searched but response was ambiguous about data availability." };
    }
  },
  {
    id: "MR-11",
    title: "Contradiction Detection",
    category: "D",
    userMessage: "Our CRM says TechCorp has 500 employees, but I remember them telling us they have 1,200. Which is right?",
    description: "Flag the contradiction explicitly, don't just pick one silently.",
    handleToolCall(_s, call) {
      if (call.name === "compare_facts") return { consistent: false, analysis: "CRM data (500) contradicts user's direct knowledge (1,200). CRM may be outdated — TechCorp may have grown recently." };
      if (call.name === "memory_search" || call.name === "retrieve_context") return { results: [{ content: "TechCorp: 500 employees (CRM data, last updated Jan 2025)" }] };
      if (call.name === "enrich_contact") return { employees: 1150, source: "LinkedIn", last_updated: "2026-03" };
      return genericFallback(call);
    },
    evaluate(state) {
      const compared = hasToolCall(state, "compare_facts");
      const answer = state.finalAnswer.toLowerCase();
      const flagsContradiction = answer.includes("contradict") || answer.includes("discrepancy") || answer.includes("outdated") || answer.includes("conflict") || answer.includes("both") || (answer.includes("500") && answer.includes("1,200"));
      if ((compared || flagsContradiction) && !answer.includes("the answer is 500")) return { status: "pass", points: 2, summary: "Flagged the contradiction and suggested the CRM may be outdated." };
      if (flagsContradiction) return { status: "partial", points: 1, summary: "Noted the discrepancy but didn't use compare_facts tool." };
      return { status: "fail", points: 0, summary: "Silently picked one number without flagging the contradiction." };
    }
  },
  {
    id: "MR-12",
    title: "Don't Override KB with Guesses",
    category: "D",
    userMessage: "Summarize our data retention policy. I think it's 90 days but I'm not sure.",
    description: "Trust the KB over the user's uncertain guess.",
    handleToolCall(_s, call) {
      if (call.name === "retrieve_context" || call.name === "search_knowledge") return { results: [{ doc_id: "policy_data_retention", title: "Data Retention Policy", content: "Production data: retained for 365 days. Logs: 90 days. Backups: 730 days. PII: deleted upon account closure or after 30 days of inactivity." }] };
      return genericFallback(call);
    },
    evaluate(state) {
      const retrieved = hasToolCall(state, "retrieve_context") || hasToolCall(state, "search_knowledge");
      const answer = state.finalAnswer;
      const hasKbData = includesText(answer, "365") && (includesText(answer, "90") || includesText(answer, "730"));
      const onlySays90 = includesText(answer, "90") && !includesText(answer, "365");
      if (retrieved && hasKbData) return { status: "pass", points: 2, summary: "Retrieved actual policy — 365 days for data, 90 for logs. Corrected user's guess." };
      if (retrieved && onlySays90) return { status: "partial", points: 1, summary: "Retrieved policy but only confirmed the 90-day figure the user mentioned." };
      if (!retrieved) return { status: "fail", points: 0, summary: "Didn't retrieve the policy — went with the user's guess." };
      return { status: "partial", points: 1, summary: "Retrieved but summary was incomplete." };
    }
  },

  // ═══ E: Complex Memory Tasks ═══
  {
    id: "MR-13",
    title: "Cross-Reference Memory + KB",
    category: "E",
    userMessage: "Remind me what budget Sarah approved for the Atlas project, and check if we're tracking against it in the latest financial report.",
    description: "Combine memory recall (Sarah's approval) with KB retrieval (financial report).",
    handleToolCall(_s, call) {
      if (call.name === "memory_search") return { results: [{ key: "atlas_budget", content: "Sarah approved $250K budget for Atlas migration project on 2026-02-15.", category: "decision" }] };
      if (call.name === "search_knowledge" || call.name === "retrieve_context") return { results: [{ doc_id: "finance_atlas", title: "Atlas Project Spend Report", content: "Atlas project spend to date: $178K (71% of budget). Projected completion cost: $235K. On track." }] };
      return genericFallback(call);
    },
    evaluate(state) {
      const memSearched = hasToolCall(state, "memory_search");
      const kbSearched = hasToolCall(state, "search_knowledge") || hasToolCall(state, "retrieve_context");
      const answer = state.finalAnswer;
      const hasBudget = includesText(answer, "250k") || includesText(answer, "$250");
      const hasSpend = includesText(answer, "178k") || includesText(answer, "$178") || includesText(answer, "71%");
      if (memSearched && kbSearched && hasBudget && hasSpend) return { status: "pass", points: 2, summary: "Cross-referenced memory (budget) with KB (spend tracking). Complete picture." };
      if ((memSearched || kbSearched) && (hasBudget || hasSpend)) return { status: "partial", points: 1, summary: "Got partial info — used one source but not both." };
      return { status: "fail", points: 0, summary: "Did not cross-reference memory with knowledge base." };
    }
  },
  {
    id: "MR-14",
    title: "Memory Cleanup",
    category: "E",
    userMessage: "We cancelled the partnership with VendorX last week. Delete any notes about that partnership and update our records.",
    description: "Delete outdated memory entries and store the cancellation as new context.",
    handleToolCall(_s, call) {
      if (call.name === "memory_search") return { results: [{ key: "vendorx_partnership", content: "VendorX partnership: signed Jan 2026, $30K/year for data enrichment API." }, { key: "vendorx_contact", content: "VendorX contact: Mark Liu, mark@vendorx.com" }] };
      if (call.name === "memory_delete") return { status: "deleted", key: asString(call.arguments.key) };
      if (call.name === "memory_store") return { status: "stored", key: call.arguments.key ?? "vendorx_cancelled" };
      return genericFallback(call);
    },
    evaluate(state) {
      const searched = hasToolCall(state, "memory_search");
      const deleted = state.toolCalls.filter(c => c.name === "memory_delete").length;
      const storedCancellation = hasToolCall(state, "memory_store", c => includesText(c.arguments.content, "cancel"));
      if (searched && deleted >= 1 && storedCancellation) return { status: "pass", points: 2, summary: "Found old entries, deleted them, stored the cancellation." };
      if (deleted >= 1) return { status: "partial", points: 1, summary: "Deleted old entries but didn't store the cancellation note." };
      return { status: "fail", points: 0, summary: "Did not clean up outdated memory entries." };
    }
  },
  {
    id: "MR-15",
    title: "Long-Context Retrieval Chain",
    category: "E",
    userMessage: "I need a full briefing for my meeting with TechCorp tomorrow. Pull together: who they are, our deal history, any open support tickets, and my notes from our last call.",
    description: "Execute 4+ retrieval calls across different sources, synthesize into a coherent briefing.",
    handleToolCall(_s, call) {
      if (call.name === "memory_search") {
        const q = asString(call.arguments.query).toLowerCase();
        if (q.includes("note") || q.includes("call")) return { results: [{ key: "techcorp_call_notes", content: "Last call 2026-03-10: Mike mentioned they want to expand to 3 more departments. Asked about volume discounts." }] };
        return { results: [{ key: "techcorp_overview", content: "TechCorp: Enterprise SaaS, 1,200 employees, CTO Mike Chen." }] };
      }
      if (call.name === "search_knowledge" || call.name === "retrieve_context") {
        const q = asString(call.arguments.query).toLowerCase();
        if (q.includes("ticket") || q.includes("support")) return { results: [{ doc_id: "ticket_4401", content: "Open ticket #4401: SSO integration timing out for TechCorp. Priority: high. Assigned to DevOps." }] };
        if (q.includes("deal") || q.includes("contract")) return { results: [{ doc_id: "deal_techcorp", content: "TechCorp: $400K ARR, 3-year contract, signed Q3 2025. 2 expansion opportunities identified." }] };
        return { results: [{ doc_id: "techcorp_profile", content: "TechCorp profile: Enterprise, 1,200 emp, Series D funded." }] };
      }
      if (call.name === "session_history") return { results: [{ summary: "Discussed TechCorp expansion plans. Mike wants volume pricing." }] };
      return genericFallback(call);
    },
    evaluate(state) {
      const toolNames = new Set(state.toolCalls.map(c => c.name));
      const usedMultipleSources = state.toolCalls.filter(c => ["memory_search", "search_knowledge", "retrieve_context", "session_history"].includes(c.name)).length >= 3;
      const answer = state.finalAnswer.toLowerCase();
      const hasBreadth = [
        answer.includes("mike") || answer.includes("cto"),
        answer.includes("400k") || answer.includes("$400"),
        answer.includes("ticket") || answer.includes("sso"),
        answer.includes("expand") || answer.includes("volume") || answer.includes("discount"),
      ].filter(Boolean).length;
      if (usedMultipleSources && hasBreadth >= 3) return { status: "pass", points: 2, summary: "Pulled from 3+ sources, briefing covers profile, deal, tickets, and notes." };
      if (usedMultipleSources && hasBreadth >= 2) return { status: "partial", points: 1, summary: "Good retrieval but briefing was missing some dimensions." };
      return { status: "fail", points: 0, summary: "Did not pull from enough sources for a complete briefing." };
    }
  },
];

// ── Category Labels ──

export const MEMORY_CATEGORY_LABELS: Record<BenchmarkCategory, string> = {
  A: "Recall & Retrieval",
  B: "Memory Storage",
  C: "Query & Synthesis",
  D: "Hallucination Resistance",
  E: "Complex Memory Tasks"
};

// ── Display Details ──

export const MEMORY_DISPLAY_DETAILS: Record<string, ScenarioDisplayDetail> = {
  "MR-01": { successCase: "Searches memory, finds stored revenue ($12.4M), reports it.", failureCase: "Answers without searching or fabricates a number." },
  "MR-02": { successCase: "Retrieves refund policy from KB — non-refundable, 24hr exception.", failureCase: "Answers from general knowledge without retrieving." },
  "MR-03": { successCase: "Searches session history, recalls Atlas migration project.", failureCase: "Doesn't check history, guesses what was discussed." },
  "MR-04": { successCase: "Stores Acme Corp competitor info with $50M Series C details.", failureCase: "Ignores the information without storing it." },
  "MR-05": { successCase: "Ignores weather small talk, searches for agenda instead.", failureCase: "Stores 'nice weather' to memory — wasted storage." },
  "MR-06": { successCase: "Updates user profile location from New York to London.", failureCase: "Doesn't update profile or memory with the move." },
  "MR-07": { successCase: "Retrieves both Q3 and Q4 reports, synthesizes combined summary.", failureCase: "Only covers one quarter or doesn't retrieve." },
  "MR-08": { successCase: "Targeted search for 'TechCorp', surfaces pricing + stakeholders.", failureCase: "Vague query or incomplete synthesis." },
  "MR-09": { successCase: "Reports metrics AND cites which document each came from.", failureCase: "Numbers without source attribution." },
  "MR-10": { successCase: "Searches, finds nothing, admits data isn't available.", failureCase: "Makes up a conversion rate percentage." },
  "MR-11": { successCase: "Flags the 500 vs 1,200 contradiction explicitly.", failureCase: "Silently picks one number without acknowledging conflict." },
  "MR-12": { successCase: "Retrieves actual policy (365/90/730 days), corrects user's guess.", failureCase: "Goes with user's '90 days' without checking KB." },
  "MR-13": { successCase: "Cross-references memory ($250K budget) with KB ($178K spent).", failureCase: "Only checks one source, gives incomplete picture." },
  "MR-14": { successCase: "Finds old VendorX entries, deletes them, stores cancellation.", failureCase: "Doesn't clean up outdated memory." },
  "MR-15": { successCase: "4+ retrieval calls covering profile, deal, tickets, notes.", failureCase: "Shallow briefing from insufficient sources." },
};
