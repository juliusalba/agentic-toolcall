// Enterprise / Agency Benchmark Suite
// Tests: MCP calling, API handling, lead gen, agent orchestration, skill creation

export { BENCHMARK_REFERENCE_DATE, BENCHMARK_REFERENCE_DAY } from "./benchmark";
export type { ScenarioStatus, BenchmarkCategory, ToolCallRecord, ToolResultRecord, ScenarioState, ScenarioEvaluation, ScenarioDefinition, ModelScenarioResult, CategoryScore, ModelScoreSummary, ScenarioDisplayDetail } from "./benchmark";
export { scoreModelResults } from "./benchmark";

import type { ScenarioDefinition, ScenarioState, ToolCallRecord, BenchmarkCategory, ScenarioDisplayDetail } from "./benchmark";

type EnterpriseToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
};

// ── System Prompt ──

export const ENTERPRISE_SYSTEM_PROMPT = `You are an enterprise AI agent with access to tools for CRM, APIs, MCP servers, task management, data analysis, and automation.

Rules:
- Use the most specific tool available for each task.
- Chain multiple tools when the task requires gathering data before acting.
- When calling APIs or MCP tools, construct parameters precisely from the context.
- If a tool fails, explain the failure and suggest recovery.
- Never fabricate data that should come from a tool.
- When delegating to sub-agents, provide clear task descriptions.
- For skill creation, output structured, reusable definitions.`;

// ── Enterprise Tool Definitions ──

export type EnterpriseToolName =
  | "search_leads"
  | "enrich_contact"
  | "send_outreach"
  | "create_task"
  | "call_api"
  | "query_database"
  | "mcp_invoke"
  | "create_skill"
  | "schedule_job"
  | "analyze_data"
  | "delegate_agent"
  | "manage_context";

export const ENTERPRISE_TOOLS: EnterpriseToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_leads",
      description: "Search CRM for leads matching criteria (industry, company size, location, title)",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          industry: { type: "string" },
          company_size: { type: "string", enum: ["startup", "smb", "mid-market", "enterprise"] },
          location: { type: "string" },
          limit: { type: "integer", default: 10 }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "enrich_contact",
      description: "Get detailed information about a contact or company from enrichment databases",
      parameters: {
        type: "object",
        properties: {
          email: { type: "string" },
          company_name: { type: "string" },
          domain: { type: "string" }
        },
        required: [],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_outreach",
      description: "Send a personalized outreach message via email, Slack, or SMS",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", enum: ["email", "slack", "sms"] },
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          template_id: { type: "string" }
        },
        required: ["channel", "to", "body"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Create a task in the project management system (Linear, Jira, Asana)",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          assignee: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
          due_date: { type: "string", format: "YYYY-MM-DD" },
          project: { type: "string" },
          labels: { type: "array", items: { type: "string" } }
        },
        required: ["title"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "call_api",
      description: "Make an HTTP request to an external API endpoint",
      parameters: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
          url: { type: "string" },
          headers: { type: "object" },
          body: { type: "object" },
          auth_type: { type: "string", enum: ["none", "bearer", "api_key", "basic"] },
          auth_token: { type: "string" }
        },
        required: ["method", "url"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "query_database",
      description: "Execute a read-only query against the connected database",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          database: { type: "string", default: "main" },
          limit: { type: "integer", default: 100 }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "mcp_invoke",
      description: "Invoke a tool on a connected MCP server",
      parameters: {
        type: "object",
        properties: {
          server: { type: "string" },
          tool: { type: "string" },
          arguments: { type: "object" }
        },
        required: ["server", "tool"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_skill",
      description: "Create a reusable automation skill with a name, trigger, and action sequence",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          trigger: { type: "string", enum: ["manual", "scheduled", "webhook", "event"] },
          steps: { type: "array", items: { type: "object" } },
          inputs: { type: "array", items: { type: "string" } }
        },
        required: ["name", "description", "trigger", "steps"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "schedule_job",
      description: "Schedule a recurring or one-time automated job",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          cron: { type: "string" },
          action: { type: "string" },
          params: { type: "object" },
          enabled: { type: "boolean", default: true }
        },
        required: ["name", "cron", "action"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "analyze_data",
      description: "Analyze a dataset and return summary statistics, trends, or insights",
      parameters: {
        type: "object",
        properties: {
          data_source: { type: "string" },
          analysis_type: { type: "string", enum: ["summary", "trend", "comparison", "anomaly"] },
          filters: { type: "object" },
          group_by: { type: "string" }
        },
        required: ["data_source", "analysis_type"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delegate_agent",
      description: "Delegate a subtask to a specialized sub-agent",
      parameters: {
        type: "object",
        properties: {
          agent_type: { type: "string", enum: ["researcher", "writer", "coder", "analyst", "coordinator"] },
          task: { type: "string" },
          context: { type: "string" },
          timeout_seconds: { type: "integer", default: 120 }
        },
        required: ["agent_type", "task"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "manage_context",
      description: "Summarize or compress conversation context to stay within token limits",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["summarize", "compress", "checkpoint", "restore"] },
          scope: { type: "string", enum: ["all", "recent", "tools_only"] }
        },
        required: ["action"],
        additionalProperties: false
      }
    }
  }
];

// ── Helpers ──

function asString(v: unknown): string { return typeof v === "string" ? v : ""; }
function normalize(v: string): string { return v.trim().toLowerCase(); }
function includesText(v: unknown, expected: string): boolean { return asString(v).toLowerCase().includes(expected.toLowerCase()); }
function hasToolCall(state: ScenarioState, name: string, pred?: (c: ToolCallRecord) => boolean): boolean { return state.toolCalls.filter(c => c.name === name).some(c => pred ? pred(c) : true); }
function firstCall(state: ScenarioState, name: string): ToolCallRecord | undefined { return state.toolCalls.find(c => c.name === name); }
function containsRefusal(answer: string): boolean { const l = answer.toLowerCase(); return l.includes("cannot") || l.includes("can't") || l.includes("don't have") || l.includes("not able"); }

function genericFallback(call: ToolCallRecord): unknown {
  return { error: `Tool ${call.name} is not relevant for this scenario.` };
}

// ── Scenarios ──

export const ENTERPRISE_SCENARIOS: ScenarioDefinition[] = [
  // ═══ A: API & MCP Integration ═══
  {
    id: "EC-01",
    title: "REST API Call",
    category: "A",
    userMessage: "Fetch the latest 5 orders from our Shopify store. The API endpoint is https://store.myshopify.com/admin/api/orders.json, use Bearer token auth with token 'shpat_abc123'.",
    description: "Construct a correct REST API call with method, URL, auth headers, and query params.",
    handleToolCall(_state, call) {
      if (call.name === "call_api") {
        return {
          status: 200,
          data: { orders: [
            { id: 1001, total: "$89.99", customer: "Alice", status: "fulfilled" },
            { id: 1002, total: "$142.50", customer: "Bob", status: "pending" },
            { id: 1003, total: "$37.00", customer: "Carol", status: "fulfilled" },
            { id: 1004, total: "$215.00", customer: "Dave", status: "shipped" },
            { id: 1005, total: "$63.25", customer: "Eve", status: "pending" },
          ]}
        };
      }
      return genericFallback(call);
    },
    evaluate(state) {
      const apiCall = firstCall(state, "call_api");
      if (!apiCall) return { status: "fail", points: 0, summary: "Did not make an API call." };
      const method = normalize(asString(apiCall.arguments.method));
      const url = asString(apiCall.arguments.url);
      const authType = normalize(asString(apiCall.arguments.auth_type));
      const hasUrl = url.includes("shopify") && url.includes("orders");
      const hasAuth = authType === "bearer" && asString(apiCall.arguments.auth_token).includes("shpat_abc123");
      if (method === "get" && hasUrl && hasAuth) {
        return { status: "pass", points: 2, summary: "Correct GET call with Bearer auth to Shopify orders endpoint." };
      }
      if (method === "get" && hasUrl) {
        return { status: "partial", points: 1, summary: "Correct endpoint but auth not properly configured." };
      }
      return { status: "fail", points: 0, summary: "API call parameters were incorrect." };
    }
  },
  {
    id: "EC-02",
    title: "Paginated Data Fetch",
    category: "A",
    userMessage: "Get all users from our API at https://api.internal.com/v1/users. The first page returns a next_cursor — keep fetching until there's no more cursor.",
    description: "Handle API pagination by making multiple calls and following cursor tokens.",
    handleToolCall(state, call) {
      if (call.name === "call_api") {
        const page = Number(state.meta.pageCount ?? 0) + 1;
        state.meta.pageCount = page;
        if (page === 1) return { status: 200, data: { users: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }], next_cursor: "cur_page2" } };
        if (page === 2) return { status: 200, data: { users: [{ id: 3, name: "Carol" }], next_cursor: null } };
        return { status: 200, data: { users: [], next_cursor: null } };
      }
      return genericFallback(call);
    },
    evaluate(state) {
      const apiCalls = state.toolCalls.filter(c => c.name === "call_api");
      if (apiCalls.length >= 2) {
        const secondUrl = asString(apiCalls[1]?.arguments.url) + JSON.stringify(apiCalls[1]?.arguments.body ?? {}) + JSON.stringify(apiCalls[1]?.arguments.headers ?? {});
        if (secondUrl.includes("cur_page2")) {
          return { status: "pass", points: 2, summary: "Followed pagination cursor across 2 pages." };
        }
        return { status: "partial", points: 1, summary: "Made multiple API calls but cursor handling unclear." };
      }
      if (apiCalls.length === 1) return { status: "fail", points: 0, summary: "Only fetched first page, did not follow next_cursor." };
      return { status: "fail", points: 0, summary: "Did not call the API." };
    }
  },
  {
    id: "EC-03",
    title: "MCP Server Tool Call",
    category: "A",
    userMessage: "Use the 'github' MCP server to create an issue in the repo 'hermes-agent' with title 'Fix token refresh bug' and label 'bug'.",
    description: "Invoke an MCP tool with correct server name, tool name, and structured arguments.",
    handleToolCall(_state, call) {
      if (call.name === "mcp_invoke") return { status: "success", issue_url: "https://github.com/hermes-agent/issues/42" };
      return genericFallback(call);
    },
    evaluate(state) {
      const mcpCall = firstCall(state, "mcp_invoke");
      if (!mcpCall) return { status: "fail", points: 0, summary: "Did not invoke MCP tool." };
      const server = normalize(asString(mcpCall.arguments.server));
      const tool = normalize(asString(mcpCall.arguments.tool));
      const args = mcpCall.arguments.arguments as Record<string, unknown> ?? {};
      const hasRepo = includesText(JSON.stringify(args), "hermes-agent");
      const hasTitle = includesText(JSON.stringify(args), "fix token refresh bug");
      if (server.includes("github") && (tool.includes("create_issue") || tool.includes("issue")) && hasRepo && hasTitle) {
        return { status: "pass", points: 2, summary: "Correct MCP invocation: github server, create_issue tool, right args." };
      }
      if (server.includes("github")) {
        return { status: "partial", points: 1, summary: "Right server but tool name or arguments were off." };
      }
      return { status: "fail", points: 0, summary: "MCP call did not target the github server correctly." };
    }
  },

  // ═══ B: Lead Gen & CRM ═══
  {
    id: "EC-04",
    title: "Lead Qualification",
    category: "B",
    userMessage: "Find enterprise SaaS companies in the Bay Area that might need our AI integration product. Get me the top leads.",
    description: "Search CRM with correct filters — industry, size, location.",
    handleToolCall(_state, call) {
      if (call.name === "search_leads") {
        return { results: [
          { id: "lead_01", company: "Acme Corp", industry: "SaaS", size: "enterprise", location: "San Francisco", contact: "jane@acme.com", score: 92 },
          { id: "lead_02", company: "DataFlow Inc", industry: "SaaS", size: "enterprise", location: "Palo Alto", contact: "mike@dataflow.io", score: 87 },
          { id: "lead_03", company: "CloudStack", industry: "SaaS", size: "mid-market", location: "San Jose", contact: "sara@cloudstack.dev", score: 78 },
        ]};
      }
      return genericFallback(call);
    },
    evaluate(state) {
      const searchCall = firstCall(state, "search_leads");
      if (!searchCall) return { status: "fail", points: 0, summary: "Did not search for leads." };
      const hasSize = normalize(asString(searchCall.arguments.company_size)) === "enterprise" || includesText(searchCall.arguments.query, "enterprise");
      const hasLocation = includesText(searchCall.arguments.location ?? searchCall.arguments.query, "bay area") || includesText(searchCall.arguments.location ?? searchCall.arguments.query, "san francisco");
      const hasIndustry = includesText(searchCall.arguments.industry ?? searchCall.arguments.query, "saas");
      if (hasSize && (hasLocation || hasIndustry)) {
        return { status: "pass", points: 2, summary: "Searched with enterprise size + location/industry filters." };
      }
      if (state.toolCalls.some(c => c.name === "search_leads")) {
        return { status: "partial", points: 1, summary: "Searched leads but filters were incomplete." };
      }
      return { status: "fail", points: 0, summary: "Search parameters did not match the request." };
    }
  },
  {
    id: "EC-05",
    title: "Enrichment Pipeline",
    category: "B",
    userMessage: "I have a lead at jane@acme.com. Enrich her profile, then send a personalized cold email introducing our AI tool.",
    description: "Chain: enrich contact → compose personalized outreach using enrichment data.",
    handleToolCall(_state, call) {
      if (call.name === "enrich_contact") {
        return { name: "Jane Chen", title: "VP Engineering", company: "Acme Corp", industry: "Enterprise SaaS", employees: 450, funding: "Series C", tech_stack: ["Python", "AWS", "PostgreSQL"], linkedin: "linkedin.com/in/janechen" };
      }
      if (call.name === "send_outreach") return { status: "sent", message_id: "msg_901" };
      return genericFallback(call);
    },
    evaluate(state) {
      const enrichCall = firstCall(state, "enrich_contact");
      const outreachCall = firstCall(state, "send_outreach");
      if (enrichCall && outreachCall && enrichCall.turn < outreachCall.turn) {
        const body = asString(outreachCall.arguments.body).toLowerCase();
        const personalized = body.includes("acme") || body.includes("jane") || body.includes("vp") || body.includes("engineering");
        if (personalized && asString(outreachCall.arguments.to).includes("jane@acme.com")) {
          return { status: "pass", points: 2, summary: "Enriched first, then sent personalized outreach using the data." };
        }
        return { status: "partial", points: 1, summary: "Chained correctly but outreach wasn't personalized from enrichment." };
      }
      if (outreachCall && !enrichCall) return { status: "fail", points: 0, summary: "Sent outreach without enriching first." };
      return { status: "fail", points: 0, summary: "Did not complete the enrichment → outreach pipeline." };
    }
  },
  {
    id: "EC-06",
    title: "Multi-Channel Outreach",
    category: "B",
    userMessage: "For the Acme Corp deal: send a follow-up email to jane@acme.com, post a Slack update to the #sales channel, and create a follow-up task for next Friday.",
    description: "Execute 3 parallel actions across different channels in one request.",
    handleToolCall(_state, call) {
      if (call.name === "send_outreach") return { status: "sent", message_id: "msg_" + Math.random().toString(36).slice(2, 6) };
      if (call.name === "create_task") return { task_id: "task_301", status: "created" };
      return genericFallback(call);
    },
    evaluate(state) {
      const emailSent = hasToolCall(state, "send_outreach", c => normalize(asString(c.arguments.channel)) === "email" && includesText(c.arguments.to, "jane@acme.com"));
      const slackSent = hasToolCall(state, "send_outreach", c => normalize(asString(c.arguments.channel)) === "slack" && includesText(c.arguments.to, "sales"));
      const taskCreated = hasToolCall(state, "create_task", c => includesText(c.arguments.title, "follow") || includesText(c.arguments.description, "acme"));
      const score = (emailSent ? 1 : 0) + (slackSent ? 1 : 0) + (taskCreated ? 1 : 0);
      if (score === 3) return { status: "pass", points: 2, summary: "All 3 actions completed: email + Slack + task." };
      if (score >= 2) return { status: "partial", points: 1, summary: `${score}/3 actions completed.` };
      return { status: "fail", points: 0, summary: "Missed multiple required actions." };
    }
  },

  // ═══ C: Agent Orchestration ═══
  {
    id: "EC-07",
    title: "Task Delegation",
    category: "C",
    userMessage: "I need a competitive analysis of Notion vs Coda vs Slite. Delegate the research to a researcher agent, then have an analyst agent summarize the findings.",
    description: "Break work into sub-agent tasks with correct agent types and handoff.",
    handleToolCall(_state, call) {
      if (call.name === "delegate_agent") {
        const agentType = normalize(asString(call.arguments.agent_type));
        if (agentType === "researcher") return { status: "complete", findings: "Notion: 30M users, $10B valuation, blocks-based. Coda: 5M users, strong formulas. Slite: 200K users, knowledge-base focused." };
        if (agentType === "analyst") return { status: "complete", summary: "Notion leads in market share, Coda in flexibility, Slite in simplicity. Recommend: position against Notion's complexity." };
        return { status: "complete", output: "Task completed." };
      }
      return genericFallback(call);
    },
    evaluate(state) {
      const delegations = state.toolCalls.filter(c => c.name === "delegate_agent");
      const hasResearcher = delegations.some(c => normalize(asString(c.arguments.agent_type)) === "researcher");
      const hasAnalyst = delegations.some(c => normalize(asString(c.arguments.agent_type)) === "analyst");
      if (hasResearcher && hasAnalyst && delegations.length >= 2) {
        const researchFirst = delegations.findIndex(c => normalize(asString(c.arguments.agent_type)) === "researcher") < delegations.findIndex(c => normalize(asString(c.arguments.agent_type)) === "analyst");
        if (researchFirst) return { status: "pass", points: 2, summary: "Delegated to researcher first, then analyst — correct pipeline." };
        return { status: "partial", points: 1, summary: "Both agents used but ordering was off." };
      }
      if (delegations.length >= 1) return { status: "partial", points: 1, summary: "Delegated but didn't use both required agent types." };
      return { status: "fail", points: 0, summary: "Did not delegate to sub-agents." };
    }
  },
  {
    id: "EC-08",
    title: "Context Management",
    category: "C",
    userMessage: "We've been working on this project for a while and the conversation is getting long. Summarize our context so far, then query the database for the latest metrics, and create a checkpoint.",
    description: "Manage context window proactively — summarize, then work, then checkpoint.",
    handleToolCall(_state, call) {
      if (call.name === "manage_context") return { status: "success", tokens_before: 45000, tokens_after: 12000 };
      if (call.name === "query_database") return { results: [{ metric: "MRR", value: "$42,500" }, { metric: "churn", value: "2.1%" }, { metric: "NPS", value: 72 }] };
      return genericFallback(call);
    },
    evaluate(state) {
      const ctxCalls = state.toolCalls.filter(c => c.name === "manage_context");
      const hasSummarize = ctxCalls.some(c => normalize(asString(c.arguments.action)) === "summarize" || normalize(asString(c.arguments.action)) === "compress");
      const hasCheckpoint = ctxCalls.some(c => normalize(asString(c.arguments.action)) === "checkpoint");
      const hasQuery = hasToolCall(state, "query_database");
      if (hasSummarize && hasQuery && hasCheckpoint) return { status: "pass", points: 2, summary: "Summarized → queried → checkpointed. Correct context management." };
      if (hasSummarize && hasQuery) return { status: "partial", points: 1, summary: "Summarized and queried but skipped checkpoint." };
      return { status: "fail", points: 0, summary: "Did not manage context proactively." };
    }
  },
  {
    id: "EC-09",
    title: "5-Tool Coordination",
    category: "C",
    userMessage: "Research our top churned accounts from the database, enrich the top one, draft a win-back email, create a re-engagement task, and schedule a weekly check on churn metrics.",
    description: "Orchestrate 5 tools in the correct dependency order.",
    handleToolCall(_state, call) {
      if (call.name === "query_database") return { results: [{ account: "TechVault", mrr_lost: "$8,500", contact: "tom@techvault.io", churn_date: "2026-03-01" }] };
      if (call.name === "enrich_contact") return { name: "Tom Rivera", title: "CTO", company: "TechVault", reason_for_churn: "switched to competitor", employees: 120 };
      if (call.name === "send_outreach") return { status: "sent", message_id: "msg_wb01" };
      if (call.name === "create_task") return { task_id: "task_501", status: "created" };
      if (call.name === "schedule_job") return { job_id: "job_101", status: "scheduled" };
      return genericFallback(call);
    },
    evaluate(state) {
      const tools = new Set(state.toolCalls.map(c => c.name));
      const hasAll = ["query_database", "enrich_contact", "send_outreach", "create_task", "schedule_job"].every(t => tools.has(t));
      if (hasAll) {
        // Check ordering: query before enrich, enrich before outreach
        const qIdx = state.toolCalls.findIndex(c => c.name === "query_database");
        const eIdx = state.toolCalls.findIndex(c => c.name === "enrich_contact");
        const oIdx = state.toolCalls.findIndex(c => c.name === "send_outreach");
        if (qIdx < eIdx && eIdx < oIdx) return { status: "pass", points: 2, summary: "All 5 tools used in correct dependency order." };
        return { status: "partial", points: 1, summary: "All 5 tools used but ordering was suboptimal." };
      }
      if (tools.size >= 3) return { status: "partial", points: 1, summary: `${tools.size}/5 required tools used.` };
      return { status: "fail", points: 0, summary: "Did not coordinate enough tools for this workflow." };
    }
  },

  // ═══ D: Skills & Automation ═══
  {
    id: "EC-10",
    title: "Skill Creation",
    category: "D",
    userMessage: "Create a reusable skill called 'daily-standup-summary' that runs every morning at 9am, queries the database for yesterday's completed tasks, and sends a summary to Slack #engineering.",
    description: "Define a structured automation skill with trigger, steps, and correct parameters.",
    handleToolCall(_state, call) {
      if (call.name === "create_skill") return { skill_id: "skill_101", status: "created" };
      return genericFallback(call);
    },
    evaluate(state) {
      const skillCall = firstCall(state, "create_skill");
      if (!skillCall) return { status: "fail", points: 0, summary: "Did not create a skill." };
      const name = normalize(asString(skillCall.arguments.name));
      const trigger = normalize(asString(skillCall.arguments.trigger));
      const steps = skillCall.arguments.steps as unknown[];
      const hasName = name.includes("standup") || name.includes("daily");
      const hasTrigger = trigger === "scheduled";
      const hasSteps = Array.isArray(steps) && steps.length >= 2;
      if (hasName && hasTrigger && hasSteps) return { status: "pass", points: 2, summary: "Skill created with correct name, scheduled trigger, and multi-step pipeline." };
      if (hasName) return { status: "partial", points: 1, summary: "Skill created but trigger or steps were incomplete." };
      return { status: "fail", points: 0, summary: "Skill definition was missing key components." };
    }
  },
  {
    id: "EC-11",
    title: "Skill Enhancement",
    category: "D",
    userMessage: "Our 'lead-scorer' skill keeps failing when the CRM is down. Add error handling — if search_leads fails, it should retry once, then fall back to the cached results from the database.",
    description: "Modify an existing skill to add retry logic and fallback — tests understanding of resilient automation.",
    handleToolCall(_state, call) {
      if (call.name === "create_skill") return { skill_id: "skill_102", status: "updated" };
      return genericFallback(call);
    },
    evaluate(state) {
      const skillCall = firstCall(state, "create_skill");
      if (!skillCall) {
        // Model might explain the fix without calling create_skill
        const answer = state.finalAnswer.toLowerCase();
        if (answer.includes("retry") && (answer.includes("fallback") || answer.includes("database") || answer.includes("cache"))) {
          return { status: "partial", points: 1, summary: "Explained the fix but didn't create the updated skill definition." };
        }
        return { status: "fail", points: 0, summary: "Did not address the skill enhancement." };
      }
      const stepsStr = JSON.stringify(skillCall.arguments.steps ?? []).toLowerCase();
      const hasRetry = stepsStr.includes("retry") || stepsStr.includes("attempt");
      const hasFallback = stepsStr.includes("fallback") || stepsStr.includes("database") || stepsStr.includes("cache");
      if (hasRetry && hasFallback) return { status: "pass", points: 2, summary: "Updated skill with retry logic and database fallback." };
      if (hasRetry || hasFallback) return { status: "partial", points: 1, summary: "Partial fix — has retry or fallback but not both." };
      return { status: "fail", points: 0, summary: "Skill update did not include error handling." };
    }
  },
  {
    id: "EC-12",
    title: "Scheduled Automation",
    category: "D",
    userMessage: "Set up a weekly job that runs every Monday at 8am: query the database for the week's revenue, analyze the trend, and send a report email to finance@company.com.",
    description: "Create a scheduled job with correct cron expression and multi-step action.",
    handleToolCall(_state, call) {
      if (call.name === "schedule_job") return { job_id: "job_201", status: "scheduled", next_run: "2026-03-23T08:00:00" };
      return genericFallback(call);
    },
    evaluate(state) {
      const jobCall = firstCall(state, "schedule_job");
      if (!jobCall) return { status: "fail", points: 0, summary: "Did not create a scheduled job." };
      const cron = asString(jobCall.arguments.cron);
      // Monday at 8am should be something like "0 8 * * 1" or "0 8 * * MON"
      const isMondayCron = (cron.includes("1") || cron.toLowerCase().includes("mon")) && cron.includes("8");
      const hasAction = asString(jobCall.arguments.action).length > 0 || asString(jobCall.arguments.name).length > 0;
      if (isMondayCron && hasAction) return { status: "pass", points: 2, summary: "Correct weekly Monday 8am cron with revenue report action." };
      if (hasAction) return { status: "partial", points: 1, summary: "Job created but cron expression was incorrect." };
      return { status: "fail", points: 0, summary: "Schedule definition was incomplete." };
    }
  },

  // ═══ E: Research & Analysis ═══
  {
    id: "EC-13",
    title: "Data Research Pipeline",
    category: "E",
    userMessage: "Query our database for this month's signups, analyze the trend compared to last month, and create a task for the growth team if signups dropped more than 10%.",
    description: "Query → analyze → conditionally act based on the analysis results.",
    handleToolCall(_state, call) {
      if (call.name === "query_database") return { results: { this_month: 847, last_month: 1023, change_pct: -17.2 } };
      if (call.name === "analyze_data") return { trend: "declining", change: "-17.2%", insight: "Signups dropped significantly — 17.2% below last month." };
      if (call.name === "create_task") return { task_id: "task_601", status: "created" };
      return genericFallback(call);
    },
    evaluate(state) {
      const queried = hasToolCall(state, "query_database");
      const analyzed = hasToolCall(state, "analyze_data");
      const taskCreated = hasToolCall(state, "create_task", c => includesText(c.arguments.title ?? c.arguments.description, "signup") || includesText(c.arguments.title ?? c.arguments.description, "growth") || includesText(c.arguments.title ?? c.arguments.description, "drop"));
      if (queried && analyzed && taskCreated) return { status: "pass", points: 2, summary: "Full pipeline: queried → analyzed → created task based on >10% drop." };
      if (queried && (analyzed || taskCreated)) return { status: "partial", points: 1, summary: "Partial pipeline completed." };
      return { status: "fail", points: 0, summary: "Did not complete the research → analyze → act pipeline." };
    }
  },
  {
    id: "EC-14",
    title: "Competitive Intelligence",
    category: "E",
    userMessage: "Use our MCP 'web-scraper' server to get pricing data from competitor.com/pricing, then analyze how our pricing compares, and delegate a writer agent to draft a competitive positioning doc.",
    description: "Chain MCP scraping → analysis → agent delegation for content creation.",
    handleToolCall(_state, call) {
      if (call.name === "mcp_invoke") return { status: "success", content: "Competitor pricing: Starter $29/mo, Pro $99/mo, Enterprise $299/mo. Free trial 14 days." };
      if (call.name === "analyze_data") return { comparison: "Our Pro at $79/mo undercuts competitor by 20%. Our Enterprise at $349/mo is 17% higher but includes more features." };
      if (call.name === "delegate_agent") return { status: "complete", output: "Draft: Our competitive advantage is clear in the mid-market segment..." };
      return genericFallback(call);
    },
    evaluate(state) {
      const mcpUsed = hasToolCall(state, "mcp_invoke", c => includesText(c.arguments.server, "web") || includesText(c.arguments.server, "scraper"));
      const analyzed = hasToolCall(state, "analyze_data");
      const delegated = hasToolCall(state, "delegate_agent", c => normalize(asString(c.arguments.agent_type)) === "writer");
      if (mcpUsed && analyzed && delegated) return { status: "pass", points: 2, summary: "MCP scrape → analysis → writer delegation. Full pipeline." };
      if (mcpUsed && (analyzed || delegated)) return { status: "partial", points: 1, summary: "Started with MCP but didn't complete all 3 steps." };
      return { status: "fail", points: 0, summary: "Did not execute the competitive intelligence pipeline." };
    }
  },
  {
    id: "EC-15",
    title: "Decision Support",
    category: "E",
    userMessage: "We're deciding between AWS, GCP, and Azure for our infrastructure. Query our current cloud spend from the database, call each provider's pricing API to estimate costs for our workload (500 vCPUs, 2TB RAM, 10TB storage), and give me a recommendation.",
    description: "Multi-source data gathering → comparison → structured recommendation. Tests completeness and data integrity.",
    handleToolCall(_state, call) {
      if (call.name === "query_database") return { results: { current_provider: "AWS", monthly_spend: "$45,200", services: ["EC2", "S3", "RDS"] } };
      if (call.name === "call_api") {
        const url = asString(call.arguments.url).toLowerCase();
        if (url.includes("aws") || url.includes("amazon")) return { status: 200, data: { estimated_monthly: "$42,800", savings: "5% with reserved instances" } };
        if (url.includes("gcp") || url.includes("google")) return { status: 200, data: { estimated_monthly: "$38,500", savings: "Sustained use discounts auto-applied" } };
        if (url.includes("azure") || url.includes("microsoft")) return { status: 200, data: { estimated_monthly: "$41,200", savings: "Hybrid benefit available" } };
        return { status: 200, data: { estimated_monthly: "N/A" } };
      }
      if (call.name === "analyze_data") return { recommendation: "GCP offers lowest baseline cost at $38,500/mo vs current $45,200 on AWS" };
      return genericFallback(call);
    },
    evaluate(state) {
      const dbQueried = hasToolCall(state, "query_database");
      const apiCalls = state.toolCalls.filter(c => c.name === "call_api");
      const providers = apiCalls.map(c => asString(c.arguments.url).toLowerCase());
      const hasMultipleProviders = providers.some(u => u.includes("aws") || u.includes("amazon")) && providers.some(u => u.includes("gcp") || u.includes("google"));
      const hasRecommendation = state.finalAnswer.toLowerCase().includes("recommend") || state.finalAnswer.toLowerCase().includes("suggest") || hasToolCall(state, "analyze_data");
      if (dbQueried && hasMultipleProviders && hasRecommendation) return { status: "pass", points: 2, summary: "Queried current spend, fetched multi-provider pricing, gave recommendation." };
      if (dbQueried && apiCalls.length >= 1) return { status: "partial", points: 1, summary: "Queried data but didn't compare enough providers." };
      return { status: "fail", points: 0, summary: "Did not gather enough data for a decision." };
    }
  },
];

// ── Category Labels ──

export const ENTERPRISE_CATEGORY_LABELS: Record<BenchmarkCategory, string> = {
  A: "API & MCP",
  B: "Lead Gen & CRM",
  C: "Orchestration",
  D: "Skills & Automation",
  E: "Research & Analysis"
};

// ── Display Details ──

export const ENTERPRISE_DISPLAY_DETAILS: Record<string, ScenarioDisplayDetail> = {
  "EC-01": { successCase: "GET request with correct Shopify URL, Bearer auth, and token.", failureCase: "Wrong method, missing auth, or incorrect URL." },
  "EC-02": { successCase: "Follows next_cursor across multiple API calls until null.", failureCase: "Only fetches first page, ignores pagination." },
  "EC-03": { successCase: "mcp_invoke with server='github', tool='create_issue', correct args.", failureCase: "Wrong server name or missing issue details." },
  "EC-04": { successCase: "search_leads with enterprise + Bay Area/SaaS filters.", failureCase: "Generic search without proper qualification criteria." },
  "EC-05": { successCase: "Enriches first, then sends personalized email using enrichment data.", failureCase: "Sends generic email without enriching contact." },
  "EC-06": { successCase: "All 3 actions: email to Jane, Slack to #sales, follow-up task.", failureCase: "Misses one or more channels." },
  "EC-07": { successCase: "Delegates to researcher first, then analyst — correct pipeline.", failureCase: "Doesn't use sub-agents or wrong agent types." },
  "EC-08": { successCase: "Summarize context → query DB → create checkpoint.", failureCase: "Doesn't manage context proactively." },
  "EC-09": { successCase: "All 5 tools in dependency order: query → enrich → outreach → task → schedule.", failureCase: "Misses tools or wrong ordering." },
  "EC-10": { successCase: "Skill with correct name, scheduled trigger, and multi-step pipeline.", failureCase: "Missing trigger type or steps." },
  "EC-11": { successCase: "Updated skill with retry logic AND database fallback.", failureCase: "No error handling added." },
  "EC-12": { successCase: "Correct Monday 8am cron expression with revenue report action.", failureCase: "Wrong cron syntax or missing action." },
  "EC-13": { successCase: "Query → analyze → create task (conditional on >10% drop).", failureCase: "Doesn't act on the analysis results." },
  "EC-14": { successCase: "MCP scrape → analyze → delegate writer for positioning doc.", failureCase: "Skips MCP or doesn't delegate writing." },
  "EC-15": { successCase: "Queries current spend, fetches 2+ provider prices, gives recommendation.", failureCase: "Doesn't compare enough providers." },
};
