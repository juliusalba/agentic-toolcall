"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Play, SlidersHorizontal, X, Zap, Clock, DollarSign, Layers, Save, Camera, CheckSquare, Square, Cpu, Monitor, Download } from "lucide-react";
import html2canvas from "html2canvas-pro";

import { scoreModelResults, CATEGORY_LABELS, type BenchmarkCategory, type ModelScenarioResult, type ModelScoreSummary } from "@/lib/benchmark";
import { ENTERPRISE_CATEGORY_LABELS } from "@/lib/benchmark-enterprise";
import { MEMORY_CATEGORY_LABELS } from "@/lib/benchmark-memory";
import { detectHardware, detectHardwareFromServer, checkAllModels, type HardwareInfo, type ModelCompatResult } from "@/lib/hardware";
import type { PublicModelConfig } from "@/lib/models";
import type { RunEvent } from "@/lib/orchestrator";

/* ── Types ── */
type ScenarioCard = { id: string; title: string; category: BenchmarkCategory; description: string; userMessage: string; successCase: string; failureCase: string };
type DashboardProps = { primaryModels: PublicModelConfig[]; secondaryModels: PublicModelConfig[]; scenarios: ScenarioCard[]; enterpriseScenarios: ScenarioCard[]; memoryScenarios: ScenarioCard[]; configError?: string | null };
type SuiteId = "general" | "business" | "memory";
type CellState = { phase: "idle" | "running" | "done"; result?: ModelScenarioResult };
type FailureDetails = { modelName: string; scenarioId: string; summary: string; rawLog: string };
type GenerationConfig = { temperature: number; top_p: number | undefined; top_k: number | undefined; min_p: number | undefined; repetition_penalty: number | undefined; tools_format: "default" | "lfm" | "hermes" };
type AdminConfig = Record<string, string>;

/* ── Constants ── */
const CFG_KEY = "toolcall15.benchmark-config";
const DEFAULT_CFG: GenerationConfig = { temperature: 0, top_p: undefined, top_k: undefined, min_p: undefined, repetition_penalty: undefined, tools_format: "default" };
const listeners = new Set<() => void>();
let _cfgRaw: string | null | undefined;
let _cfgSnap: GenerationConfig = DEFAULT_CFG;

const DEMO_MODELS = ["GPT-4.1", "Claude Sonnet 4", "Gemma 3 27B", "Qwen 3 32B", "Hermes 3 70B", "GLM-4 32B", "MiniMax-M1", "Xiaomi MiMo 7B", "Hermes 3 8B", "DeepSeek V3"];
const DEMO_PROVIDERS: Record<string, string> = { "GPT-4.1": "OpenRouter", "Claude Sonnet 4": "OpenRouter", "Gemma 3 27B": "OpenRouter", "Qwen 3 32B": "OpenRouter", "Hermes 3 70B": "OpenRouter", "GLM-4 32B": "OpenRouter", "MiniMax-M1": "OpenRouter", "Xiaomi MiMo 7B": "OpenRouter", "Hermes 3 8B": "Ollama", "DeepSeek V3": "OpenRouter" };
const DEMO_LATENCY: Record<string, string> = { "GPT-4.1":"1.2s","Claude Sonnet 4":"1.6s","Gemma 3 27B":"1.8s","Qwen 3 32B":"1.5s","Hermes 3 70B":"2.4s","GLM-4 32B":"2.1s","MiniMax-M1":"2.8s","Xiaomi MiMo 7B":"0.8s","Hermes 3 8B":"0.9s","DeepSeek V3":"1.3s" };
const DEMO_CTX: Record<string, string> = { "GPT-4.1":"1M","Claude Sonnet 4":"200K","Gemma 3 27B":"128K","Qwen 3 32B":"128K","Hermes 3 70B":"128K","GLM-4 32B":"128K","MiniMax-M1":"1M","Xiaomi MiMo 7B":"128K","Hermes 3 8B":"128K","DeepSeek V3":"128K" };
const DEMO_COST: Record<string, string> = { "GPT-4.1":"$0.04","Claude Sonnet 4":"$0.05","Gemma 3 27B":"$0.01","Qwen 3 32B":"$0.01","Hermes 3 70B":"$0.02","GLM-4 32B":"$0.01","MiniMax-M1":"$0.02","Xiaomi MiMo 7B":"<$0.01","Hermes 3 8B":"Free","DeepSeek V3":"$0.01" };

// Compute demo score from demo results grid
function computeDemoScore(model: string, suiteId: SuiteId): number {
  const grid = DEMO_RESULTS[suiteId]?.[model];
  if (!grid) return 0;
  const vals = Object.values(grid);
  const pts = vals.reduce((s, v) => s + (v === "pass" ? 2 : v === "partial" ? 1 : 0), 0);
  return Math.round((pts / (vals.length * 2)) * 100);
}
type DemoGrid = Record<string, Record<string, "pass" | "partial" | "fail">>;
const DEMO_RESULTS: Record<SuiteId, DemoGrid> = {
  general: {
    "GPT-4.1":          { "TC-01":"pass","TC-02":"pass","TC-03":"pass","TC-04":"pass","TC-05":"pass","TC-06":"pass","TC-07":"pass","TC-08":"pass","TC-09":"pass","TC-10":"pass","TC-11":"pass","TC-12":"pass","TC-13":"pass","TC-14":"partial","TC-15":"pass" },
    "Claude Sonnet 4":  { "TC-01":"pass","TC-02":"pass","TC-03":"pass","TC-04":"pass","TC-05":"pass","TC-06":"pass","TC-07":"pass","TC-08":"pass","TC-09":"pass","TC-10":"pass","TC-11":"pass","TC-12":"pass","TC-13":"partial","TC-14":"pass","TC-15":"partial" },
    "DeepSeek V3":      { "TC-01":"pass","TC-02":"pass","TC-03":"pass","TC-04":"pass","TC-05":"pass","TC-06":"pass","TC-07":"pass","TC-08":"pass","TC-09":"pass","TC-10":"pass","TC-11":"pass","TC-12":"partial","TC-13":"pass","TC-14":"partial","TC-15":"pass" },
    "Gemma 3 27B":      { "TC-01":"pass","TC-02":"pass","TC-03":"pass","TC-04":"pass","TC-05":"pass","TC-06":"pass","TC-07":"pass","TC-08":"pass","TC-09":"partial","TC-10":"pass","TC-11":"pass","TC-12":"partial","TC-13":"partial","TC-14":"pass","TC-15":"partial" },
    "Qwen 3 32B":       { "TC-01":"pass","TC-02":"pass","TC-03":"pass","TC-04":"pass","TC-05":"pass","TC-06":"partial","TC-07":"pass","TC-08":"pass","TC-09":"partial","TC-10":"pass","TC-11":"pass","TC-12":"partial","TC-13":"fail","TC-14":"partial","TC-15":"pass" },
    "Hermes 3 70B":     { "TC-01":"pass","TC-02":"pass","TC-03":"pass","TC-04":"pass","TC-05":"pass","TC-06":"partial","TC-07":"pass","TC-08":"pass","TC-09":"partial","TC-10":"pass","TC-11":"pass","TC-12":"partial","TC-13":"fail","TC-14":"partial","TC-15":"pass" },
    "GLM-4 32B":        { "TC-01":"pass","TC-02":"pass","TC-03":"pass","TC-04":"pass","TC-05":"partial","TC-06":"partial","TC-07":"pass","TC-08":"pass","TC-09":"fail","TC-10":"pass","TC-11":"pass","TC-12":"fail","TC-13":"fail","TC-14":"partial","TC-15":"pass" },
    "MiniMax-M1":       { "TC-01":"pass","TC-02":"pass","TC-03":"pass","TC-04":"pass","TC-05":"partial","TC-06":"fail","TC-07":"partial","TC-08":"pass","TC-09":"fail","TC-10":"pass","TC-11":"pass","TC-12":"fail","TC-13":"fail","TC-14":"pass","TC-15":"partial" },
    "Xiaomi MiMo 7B":   { "TC-01":"pass","TC-02":"pass","TC-03":"pass","TC-04":"pass","TC-05":"fail","TC-06":"fail","TC-07":"partial","TC-08":"pass","TC-09":"fail","TC-10":"pass","TC-11":"partial","TC-12":"fail","TC-13":"fail","TC-14":"partial","TC-15":"fail" },
    "Hermes 3 8B":      { "TC-01":"pass","TC-02":"pass","TC-03":"pass","TC-04":"pass","TC-05":"fail","TC-06":"fail","TC-07":"partial","TC-08":"partial","TC-09":"fail","TC-10":"pass","TC-11":"pass","TC-12":"fail","TC-13":"fail","TC-14":"partial","TC-15":"partial" },
  },
  business: {
    "GPT-4.1":          { "EC-01":"pass","EC-02":"pass","EC-03":"pass","EC-04":"pass","EC-05":"pass","EC-06":"pass","EC-07":"pass","EC-08":"pass","EC-09":"pass","EC-10":"pass","EC-11":"pass","EC-12":"partial","EC-13":"pass","EC-14":"pass","EC-15":"partial" },
    "Claude Sonnet 4":  { "EC-01":"pass","EC-02":"pass","EC-03":"pass","EC-04":"pass","EC-05":"pass","EC-06":"pass","EC-07":"pass","EC-08":"pass","EC-09":"partial","EC-10":"pass","EC-11":"partial","EC-12":"pass","EC-13":"pass","EC-14":"pass","EC-15":"pass" },
    "DeepSeek V3":      { "EC-01":"pass","EC-02":"pass","EC-03":"partial","EC-04":"pass","EC-05":"pass","EC-06":"pass","EC-07":"pass","EC-08":"pass","EC-09":"pass","EC-10":"partial","EC-11":"pass","EC-12":"pass","EC-13":"pass","EC-14":"partial","EC-15":"pass" },
    "Gemma 3 27B":      { "EC-01":"pass","EC-02":"partial","EC-03":"pass","EC-04":"pass","EC-05":"pass","EC-06":"partial","EC-07":"partial","EC-08":"pass","EC-09":"partial","EC-10":"pass","EC-11":"partial","EC-12":"partial","EC-13":"partial","EC-14":"partial","EC-15":"partial" },
    "Qwen 3 32B":       { "EC-01":"pass","EC-02":"pass","EC-03":"partial","EC-04":"pass","EC-05":"partial","EC-06":"pass","EC-07":"pass","EC-08":"partial","EC-09":"partial","EC-10":"pass","EC-11":"pass","EC-12":"partial","EC-13":"fail","EC-14":"partial","EC-15":"partial" },
    "Hermes 3 70B":     { "EC-01":"pass","EC-02":"partial","EC-03":"pass","EC-04":"pass","EC-05":"pass","EC-06":"partial","EC-07":"partial","EC-08":"pass","EC-09":"partial","EC-10":"partial","EC-11":"pass","EC-12":"fail","EC-13":"fail","EC-14":"partial","EC-15":"pass" },
    "GLM-4 32B":        { "EC-01":"pass","EC-02":"partial","EC-03":"partial","EC-04":"partial","EC-05":"partial","EC-06":"fail","EC-07":"fail","EC-08":"pass","EC-09":"fail","EC-10":"pass","EC-11":"partial","EC-12":"fail","EC-13":"fail","EC-14":"fail","EC-15":"partial" },
    "MiniMax-M1":       { "EC-01":"pass","EC-02":"fail","EC-03":"partial","EC-04":"pass","EC-05":"partial","EC-06":"fail","EC-07":"fail","EC-08":"partial","EC-09":"fail","EC-10":"partial","EC-11":"fail","EC-12":"fail","EC-13":"fail","EC-14":"partial","EC-15":"fail" },
    "Xiaomi MiMo 7B":   { "EC-01":"partial","EC-02":"fail","EC-03":"fail","EC-04":"partial","EC-05":"fail","EC-06":"fail","EC-07":"fail","EC-08":"fail","EC-09":"fail","EC-10":"partial","EC-11":"fail","EC-12":"fail","EC-13":"fail","EC-14":"fail","EC-15":"fail" },
    "Hermes 3 8B":      { "EC-01":"pass","EC-02":"fail","EC-03":"partial","EC-04":"partial","EC-05":"fail","EC-06":"fail","EC-07":"fail","EC-08":"partial","EC-09":"fail","EC-10":"pass","EC-11":"partial","EC-12":"fail","EC-13":"fail","EC-14":"fail","EC-15":"fail" },
  },
  memory: {
    "GPT-4.1":          { "MR-01":"pass","MR-02":"pass","MR-03":"pass","MR-04":"pass","MR-05":"pass","MR-06":"pass","MR-07":"pass","MR-08":"pass","MR-09":"pass","MR-10":"pass","MR-11":"pass","MR-12":"pass","MR-13":"pass","MR-14":"pass","MR-15":"partial" },
    "Claude Sonnet 4":  { "MR-01":"pass","MR-02":"pass","MR-03":"pass","MR-04":"pass","MR-05":"pass","MR-06":"pass","MR-07":"pass","MR-08":"pass","MR-09":"partial","MR-10":"pass","MR-11":"pass","MR-12":"pass","MR-13":"pass","MR-14":"partial","MR-15":"pass" },
    "DeepSeek V3":      { "MR-01":"pass","MR-02":"pass","MR-03":"pass","MR-04":"pass","MR-05":"partial","MR-06":"pass","MR-07":"pass","MR-08":"pass","MR-09":"partial","MR-10":"pass","MR-11":"partial","MR-12":"pass","MR-13":"pass","MR-14":"pass","MR-15":"partial" },
    "Gemma 3 27B":      { "MR-01":"pass","MR-02":"pass","MR-03":"pass","MR-04":"pass","MR-05":"pass","MR-06":"partial","MR-07":"pass","MR-08":"partial","MR-09":"partial","MR-10":"pass","MR-11":"partial","MR-12":"pass","MR-13":"partial","MR-14":"partial","MR-15":"partial" },
    "Qwen 3 32B":       { "MR-01":"pass","MR-02":"pass","MR-03":"pass","MR-04":"partial","MR-05":"pass","MR-06":"pass","MR-07":"partial","MR-08":"pass","MR-09":"partial","MR-10":"pass","MR-11":"fail","MR-12":"partial","MR-13":"partial","MR-14":"partial","MR-15":"fail" },
    "Hermes 3 70B":     { "MR-01":"pass","MR-02":"pass","MR-03":"partial","MR-04":"pass","MR-05":"partial","MR-06":"pass","MR-07":"pass","MR-08":"partial","MR-09":"fail","MR-10":"pass","MR-11":"fail","MR-12":"partial","MR-13":"partial","MR-14":"fail","MR-15":"partial" },
    "GLM-4 32B":        { "MR-01":"pass","MR-02":"pass","MR-03":"partial","MR-04":"partial","MR-05":"fail","MR-06":"partial","MR-07":"partial","MR-08":"fail","MR-09":"fail","MR-10":"partial","MR-11":"fail","MR-12":"fail","MR-13":"fail","MR-14":"fail","MR-15":"fail" },
    "MiniMax-M1":       { "MR-01":"pass","MR-02":"partial","MR-03":"partial","MR-04":"partial","MR-05":"fail","MR-06":"fail","MR-07":"fail","MR-08":"fail","MR-09":"fail","MR-10":"partial","MR-11":"fail","MR-12":"fail","MR-13":"fail","MR-14":"fail","MR-15":"fail" },
    "Xiaomi MiMo 7B":   { "MR-01":"pass","MR-02":"partial","MR-03":"fail","MR-04":"fail","MR-05":"fail","MR-06":"fail","MR-07":"fail","MR-08":"fail","MR-09":"fail","MR-10":"fail","MR-11":"fail","MR-12":"fail","MR-13":"fail","MR-14":"fail","MR-15":"fail" },
    "Hermes 3 8B":      { "MR-01":"pass","MR-02":"partial","MR-03":"fail","MR-04":"partial","MR-05":"fail","MR-06":"fail","MR-07":"fail","MR-08":"fail","MR-09":"fail","MR-10":"partial","MR-11":"fail","MR-12":"fail","MR-13":"fail","MR-14":"fail","MR-15":"fail" },
  },
};

const CAT_DESC: Record<string, Record<BenchmarkCategory, string>> = {
  general: { A: "Simple daily lookups — weather, stocks, common knowledge", B: "Get parameters exactly right — units, dates, multi-value", C: "Chain multiple tools — contact→email, parallel, conditional", D: "Judgment calls — mental math, refusals, 4-step workflows", E: "When things break — retries, errors, data integrity" },
  business: { A: "REST APIs, pagination, MCP server invocation", B: "CRM search, contact enrichment, multi-channel outreach", C: "Sub-agent delegation, context management, 5-tool chains", D: "Skill creation, error-handling upgrades, cron scheduling", E: "Data pipelines, competitive intel, multi-source decisions" },
  memory: { A: "Fact recall, knowledge base lookup, session history", B: "Store important info, skip trivia, update profiles", C: "Multi-doc synthesis, targeted queries, source citations", D: "Admit unknowns, flag contradictions, trust KB over guesses", E: "Cross-reference sources, memory cleanup, full briefing prep" },
};

/* ── Helpers ── */
function buildCells(models: PublicModelConfig[], scenarios: ScenarioCard[]): Record<string, Record<string, CellState>> {
  return Object.fromEntries(models.map(m => [m.id, Object.fromEntries(scenarios.map(s => [s.id, { phase: "idle" } as CellState]))]));
}
function extractLabel(n: string) { const m = n.toLowerCase().match(/(\d+(?:\.\d+)?)b([a-z0-9\-]*)/); if (!m) return n; const s = m[2].replace(/^-+/,""); return s ? `${m[1]}b-${s}` : `${m[1]}b`; }
const VORDER = ["0.8b","2b","4b","9b","27b","35b","122b","397b"];
function vIdx(n: string) { const i = VORDER.indexOf(extractLabel(n)); return i === -1 ? 1e9 : i; }
function isTimeout(s?: string) { return s?.toLowerCase().includes("timed out") ?? false; }
function fmtLat(ms: number) { return ms >= 1000 ? `${(ms/1000).toFixed(1)}s` : `${ms}ms`; }

/* ── Pref store ── */
function subStore(l: () => void) { listeners.add(l); if (typeof window === "undefined") return () => { listeners.delete(l); }; const h = (e: StorageEvent) => { if (e.key === CFG_KEY) l(); }; window.addEventListener("storage", h); return () => { listeners.delete(l); window.removeEventListener("storage", h); }; }
function emitStore() { for (const l of listeners) l(); }
function readCfg(): GenerationConfig {
  if (typeof window === "undefined") return DEFAULT_CFG;
  const raw = window.localStorage.getItem(CFG_KEY);
  if (raw === _cfgRaw) return _cfgSnap;
  _cfgRaw = raw;
  try { const p = JSON.parse(raw ?? "null") as Partial<GenerationConfig> | null;
    if (!p) { _cfgSnap = DEFAULT_CFG; return _cfgSnap; }
    _cfgSnap = { temperature: typeof p.temperature === "number" ? p.temperature : 0, top_p: typeof p.top_p === "number" ? p.top_p : undefined, top_k: typeof p.top_k === "number" ? p.top_k : undefined, min_p: typeof p.min_p === "number" ? p.min_p : undefined, repetition_penalty: typeof p.repetition_penalty === "number" ? p.repetition_penalty : undefined, tools_format: p.tools_format === "lfm" ? "lfm" : p.tools_format === "hermes" ? "hermes" : "default" };
  } catch { _cfgSnap = DEFAULT_CFG; }
  return _cfgSnap;
}
function saveCfg(c: GenerationConfig) { if (typeof window !== "undefined") { window.localStorage.setItem(CFG_KEY, JSON.stringify(c)); emitStore(); } }

/* ── Icons ── */
const Chk = () => <svg viewBox="0 0 20 20"><path d="M4.5 10.2 8.2 14l7.3-8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4"/></svg>;
const Prt = () => <svg viewBox="0 0 20 20"><path d="M5 10h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4"/></svg>;
const Crs = () => <svg viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4"/></svg>;
const Tmr = () => <svg viewBox="0 0 20 20"><path d="M7.5 2.75h5M10 5.25v4l2.4 1.5M6.25 2.75h7.5M10 17.25a6.25 6.25 0 1 0 0-12.5 6.25 6.25 0 0 0 0 12.5Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9"/></svg>;

function StatusIcon({ s }: { s: "pass" | "partial" | "fail" | "timeout" }) {
  return s === "pass" ? <Chk /> : s === "partial" ? <Prt /> : s === "timeout" ? <Tmr /> : <Crs />;
}

/* ── Admin Dialog ── */
function AdminDialog({ open, onClose, gp, setGp }: { open: boolean; onClose: () => void; gp: GenerationConfig; setGp: React.Dispatch<React.SetStateAction<GenerationConfig>> }) {
  const [tab, setTab] = useState<"keys"|"models"|"gen">("keys");
  const [ac, setAc] = useState<AdminConfig>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { if (open) fetch("/api/config").then(r=>r.json()).then(d=>setAc(d as AdminConfig)).catch(()=>{}); }, [open]);
  const upd = (k: string, v: string) => setAc(p => ({...p, [k]: v}));
  const save = async () => { setSaving(true); setMsg(""); try { const r = await fetch("/api/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(ac)}); setMsg(r.ok ? "Saved. Restart server." : "Error."); } catch { setMsg("Network error."); } setSaving(false); };
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-shell" onClick={e=>e.stopPropagation()}>
        <div className="dialog-header"><h2>Configuration</h2><button className="dialog-close" onClick={onClose}><X size={15}/></button></div>
        <div className="admin-tabs">
          <button className={`admin-tab ${tab==="keys"?"active":""}`} onClick={()=>setTab("keys")}>API Keys</button>
          <button className={`admin-tab ${tab==="models"?"active":""}`} onClick={()=>setTab("models")}>Models</button>
          <button className={`admin-tab ${tab==="gen"?"active":""}`} onClick={()=>setTab("gen")}>Generation</button>
        </div>
        <div className="admin-body">
          {tab==="keys" && <div className="admin-form">
            <label className="field"><span className="field-label">OpenRouter API Key</span><input className="field-input" type="password" placeholder="sk-or-..." value={ac.OPENROUTER_API_KEY??""} onChange={e=>upd("OPENROUTER_API_KEY",e.target.value)}/></label>
            <div className="field-row"><label className="field"><span className="field-label">Ollama Host</span><input className="field-input" placeholder="http://localhost:11434" value={ac.OLLAMA_HOST??""} onChange={e=>upd("OLLAMA_HOST",e.target.value)}/></label><label className="field"><span className="field-label">vLLM Host</span><input className="field-input" placeholder="http://localhost:8000" value={ac.VLLM_HOST??""} onChange={e=>upd("VLLM_HOST",e.target.value)}/></label></div>
            <div className="field-row"><label className="field"><span className="field-label">llama.cpp Host</span><input className="field-input" placeholder="http://localhost:8080" value={ac.LLAMACPP_HOST??""} onChange={e=>upd("LLAMACPP_HOST",e.target.value)}/></label><label className="field"><span className="field-label">LM Studio Host</span><input className="field-input" placeholder="http://localhost:1234" value={ac.LMSTUDIO_HOST??""} onChange={e=>upd("LMSTUDIO_HOST",e.target.value)}/></label></div>
            <div className="field-row"><label className="field"><span className="field-label">MLX Host</span><input className="field-input" placeholder="http://localhost:8082" value={ac.MLX_HOST??""} onChange={e=>upd("MLX_HOST",e.target.value)}/></label><label className="field"><span className="field-label">Timeout (s)</span><input className="field-input" type="number" placeholder="30" value={ac.MODEL_REQUEST_TIMEOUT_SECONDS??""} onChange={e=>upd("MODEL_REQUEST_TIMEOUT_SECONDS",e.target.value)}/></label></div>
          </div>}
          {tab==="models" && <div className="admin-form">
            <p className="admin-hint">Comma-separated <code>provider:model</code> — openrouter, ollama, llamacpp, vllm, mlx, lmstudio</p>
            <label className="field"><span className="field-label">Primary Models</span><textarea className="field-input field-textarea" rows={3} placeholder="ollama:hermes3:8b,openrouter:openai/gpt-4.1" value={ac.LLM_MODELS??""} onChange={e=>upd("LLM_MODELS",e.target.value)}/></label>
            <label className="field"><span className="field-label">Secondary Models (comparison)</span><textarea className="field-input field-textarea" rows={2} placeholder="openrouter:anthropic/claude-sonnet-4" value={ac.LLM_MODELS_2??""} onChange={e=>upd("LLM_MODELS_2",e.target.value)}/></label>
          </div>}
          {tab==="gen" && <div className="config-grid admin-form">
            <label className="field"><span className="field-label">Temperature</span><input className="field-input" type="number" step="0.1" min="0" max="2" value={gp.temperature} onChange={e=>setGp(p=>({...p,temperature:parseFloat(e.target.value)||0}))}/></label>
            <label className="field"><span className="field-label">Top P</span><input className="field-input" type="number" step="0.05" placeholder="default" value={gp.top_p??""} onChange={e=>setGp(p=>({...p,top_p:e.target.value===""?undefined:parseFloat(e.target.value)}))}/></label>
            <label className="field"><span className="field-label">Top K</span><input className="field-input" type="number" step="1" placeholder="default" value={gp.top_k??""} onChange={e=>setGp(p=>({...p,top_k:e.target.value===""?undefined:parseInt(e.target.value,10)}))}/></label>
            <label className="field"><span className="field-label">Min P</span><input className="field-input" type="number" step="0.05" placeholder="default" value={gp.min_p??""} onChange={e=>setGp(p=>({...p,min_p:e.target.value===""?undefined:parseFloat(e.target.value)}))}/></label>
            <label className="field config-field-wide"><span className="field-label">Tools Format</span><select className="field-input" value={gp.tools_format} onChange={e=>setGp(p=>({...p,tools_format:e.target.value as "default"|"lfm"|"hermes"}))}><option value="default">default — OpenAI tools</option><option value="hermes">hermes — ChatML &lt;tool_call&gt;</option><option value="lfm">lfm — prompt injection</option></select></label>
          </div>}
        </div>
        {(tab==="keys"||tab==="models") && <div className="admin-footer"><button className="btn btn-primary" onClick={save} disabled={saving}><Save size={12}/>{saving?"Saving...":"Save"}</button>{msg&&<span className="admin-save-msg">{msg}</span>}</div>}
      </div>
    </div>
  );
}

/* ── Session Selector ── */
function SessionDialog({ open, onClose, models, selected, setSelected, onStart }: {
  open: boolean; onClose: () => void; models: PublicModelConfig[];
  selected: Set<string>; setSelected: React.Dispatch<React.SetStateAction<Set<string>>>; onStart: () => void;
}) {
  if (!open) return null;
  const allSelected = models.length > 0 && models.every(m => selected.has(m.id));
  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => { if (allSelected) setSelected(new Set()); else setSelected(new Set(models.map(m => m.id))); };
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-shell" onClick={e=>e.stopPropagation()}>
        <div className="dialog-header"><h2>New Session</h2><button className="dialog-close" onClick={onClose}><X size={15}/></button></div>
        <div className="admin-body">
          {models.length === 0 ? (
            <div className="session-empty">
              <p>No models configured yet.</p>
              <p className="admin-hint">Click <strong>Configure → Models</strong> to add models, then come back here.</p>
            </div>
          ) : (<>
            <p className="admin-hint">Select which models to include in this benchmark run.</p>
            <button className="session-select-all" type="button" onClick={toggleAll}>
              {allSelected ? <CheckSquare size={14}/> : <Square size={14}/>}
              {allSelected ? "Deselect All" : "Select All"} ({models.length} models)
            </button>
            <div className="session-list">
              {models.map(m => (
                <button key={m.id} className={`session-model ${selected.has(m.id) ? "session-model-on" : ""}`} type="button" onClick={() => toggle(m.id)}>
                  {selected.has(m.id) ? <CheckSquare size={14}/> : <Square size={14}/>}
                  <span className="session-model-name">{m.model}</span>
                  <span className="session-model-provider">{m.provider}</span>
                </button>
              ))}
            </div>
          </>)}
        </div>
        {models.length > 0 && (
          <div className="admin-footer">
            <button className="btn btn-primary" onClick={onStart} disabled={selected.size === 0}>
              <Play size={12}/> Run {selected.size} Model{selected.size !== 1 ? "s" : ""}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Trace Dialog ── */
function TraceDialog({ details, onClose }: { details: FailureDetails|null; onClose:()=>void }) {
  if (!details) return null;
  const to = isTimeout(details.summary);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-shell trace-dialog" onClick={e=>e.stopPropagation()}>
        <div className="dialog-header"><div><p className="eyebrow">Trace</p><h2>{details.scenarioId} · {details.modelName}</h2></div><button className="dialog-close" onClick={onClose}><X size={15}/></button></div>
        <div className="dialog-summary"><span className={`status-tag ${to?"status-tag-timeout":"status-tag-fail"}`}>{to?"timeout":"fail"}</span><span>{details.summary}</span></div>
        <pre className="trace-log">{details.rawLog}</pre>
      </div>
    </div>
  );
}

/* ══════════ Dashboard ══════════ */

export function Dashboard({ primaryModels, secondaryModels, scenarios, enterpriseScenarios, memoryScenarios, configError }: DashboardProps) {
  const allModels = useMemo(() => [...primaryModels, ...secondaryModels], [primaryModels, secondaryModels]);
  const [suite, setSuite] = useState<SuiteId>("general");
  const activeScenarios = suite === "business" ? enterpriseScenarios : suite === "memory" ? memoryScenarios : scenarios;
  const [cells, setCells] = useState(() => buildCells(allModels, scenarios));
  const cellsRef = useRef(cells);
  const [scores, setScores] = useState<Record<string, ModelScoreSummary>>({});
  const [status, setStatus] = useState<"idle"|"running"|"done"|"error">("idle");
  const [curSc, setCurSc] = useState(scenarios[0]?.id ?? "");
  const [expandedTc, setExpandedTc] = useState<string|null>(null);
  const [trace, setTrace] = useState<FailureDetails|null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [cfgOpen, setCfgOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"grid"|"leaderboard"|"hardware">("grid");
  const [hwInfo, setHwInfo] = useState<HardwareInfo|null>(null);
  const [hwModels, setHwModels] = useState<ModelCompatResult[]>([]);
  const [screenshotMsg, setScreenshotMsg] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource|null>(null);
  const gp = useSyncExternalStore(subStore, readCfg, ()=>DEFAULT_CFG);
  const setGp: React.Dispatch<React.SetStateAction<GenerationConfig>> = v => { saveCfg(typeof v==="function"?v(readCfg()):v); };

  const hasModels = allModels.length > 0;
  const dpri = useMemo(()=>[...primaryModels].sort((a,b)=>vIdx(a.model)-vIdx(b.model)),[primaryModels]);
  const dsec = useMemo(()=>[...secondaryModels].sort((a,b)=>vIdx(a.model)-vIdx(b.model)),[secondaryModels]);
  const dall = useMemo(()=>[...dpri,...dsec],[dpri,dsec]);
  const ranked = useMemo(()=>dall.flatMap(m=>{const s=scores[m.id];return s?[{m,s}]:[]}).sort((a,b)=>b.s.finalScore!==a.s.finalScore?b.s.finalScore-a.s.finalScore:b.s.totalPoints-a.s.totalPoints),[dall,scores]);

  useEffect(()=>()=>{esRef.current?.close()},[]);

  // Persist last run results to localStorage
  function saveResults(s: Record<string, ModelScoreSummary>) {
    try { localStorage.setItem("hermesbench.lastScores", JSON.stringify(s)); } catch { /* quota */ }
  }
  function loadResults(): Record<string, ModelScoreSummary> | null {
    try { const r = localStorage.getItem("hermesbench.lastScores"); return r ? JSON.parse(r) : null; } catch { return null; }
  }
  function exportJson() {
    const data = { timestamp: new Date().toISOString(), models: ranked.map(({m,s})=>({model:m.model,provider:m.provider,score:s.finalScore,points:`${s.totalPoints}/${s.maxPoints}`,avgLatencyMs:s.avgLatencyMs,avgTurns:s.avgTurns,categories:s.categoryScores})), scenarios: scenarios.map(s=>({id:s.id,title:s.title,category:s.category})) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `hermes-bench-${new Date().toISOString().slice(0,10)}.json`; a.click();
    URL.revokeObjectURL(a.href);
  }

  // Restore last results on mount
  useEffect(()=>{ const s = loadResults(); if (s && Object.keys(s).length > 0) setScores(s); },[]);

  async function scanHardware() {
    // Try server-side scan first (accurate), fall back to browser APIs (limited)
    const serverHw = await detectHardwareFromServer();
    const hw = serverHw ?? detectHardware();
    setHwInfo(hw);
    setHwModels(checkAllModels(hw));
  }

  // Auto-scan when switching to hardware tab
  useEffect(()=>{ if (view === "hardware" && !hwInfo) scanHardware(); },[view, hwInfo]);

  const upCell = (mid:string,sid:string,fn:(p:CellState)=>CellState) => setCells(p=>{const n={...p,[mid]:{...p[mid],[sid]:fn(p[mid]?.[sid]??{phase:"idle"})}};cellsRef.current=n;return n;});

  /* Screenshot capture */
  async function captureScreenshot(annotated: boolean) {
    const el = gridRef.current;
    if (!el) return;
    try {
      const canvas = await html2canvas(el, { backgroundColor: "#09090b", scale: 2, useCORS: true });

      if (annotated) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Draw summary banner at bottom
          const bh = 80;
          ctx.fillStyle = "#111113";
          ctx.fillRect(0, canvas.height - bh, canvas.width, bh);
          ctx.fillStyle = "#3b82f6";
          ctx.font = "bold 28px Inter, sans-serif";
          ctx.fillText("HERMES BENCH", 40, canvas.height - bh + 34);
          ctx.fillStyle = "#a1a1aa";
          ctx.font = "20px Inter, sans-serif";
          const modelCount = ranked.length > 0 ? ranked.length : selectedModelIds.size || dall.length;
          const topScore = ranked.length > 0 ? `Top: ${ranked[0].m.model} ${ranked[0].s.finalScore}%` : "";
          ctx.fillText(`${modelCount} models · 15 tests · ${gp.tools_format} format · ${new Date().toLocaleDateString()} ${topScore}`, 40, canvas.height - bh + 62);
        }
      }

      const dataUrl = canvas.toDataURL("image/png");
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const suffix = annotated ? "summary" : "plain";
      const filename = `bench-${ts}-${suffix}.png`;

      // Save to server
      await fetch("/api/screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData: dataUrl, filename })
      });

      // Also trigger download
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = filename;
      a.click();

      return filename;
    } catch (e) {
      console.error("Screenshot failed:", e);
    }
  }

  async function captureAll() {
    setScreenshotMsg("Capturing...");
    await captureScreenshot(false);
    await captureScreenshot(true);
    setScreenshotMsg("Saved to /public/screenshots/");
    setTimeout(() => setScreenshotMsg(""), 4000);
  }

  /* Run benchmark */
  function run(tid?: string, modelIds?: string[]) {
    esRef.current?.close();
    const runModels = modelIds ? dall.filter(m => modelIds.includes(m.id)) : dall;
    if (runModels.length === 0) return;

    if(tid){setCells(p=>{const n=Object.fromEntries(runModels.map(m=>[m.id,{...(p[m.id]??{}),[tid]:{phase:"idle"} satisfies CellState}]));cellsRef.current=n;return n;});setCurSc(tid);}
    else{const n=buildCells(runModels,scenarios);cellsRef.current=n;setCells(n);setScores({});setCurSc(scenarios[0]?.id??"");}
    setStatus("running");setTrace(null);setErrorMsg("");
    const ps=new URLSearchParams({models:runModels.map(m=>m.id).join(",")});
    if(tid)ps.set("scenarios",tid);
    if(gp.temperature!==0)ps.set("temperature",String(gp.temperature));
    if(gp.top_p!==undefined)ps.set("top_p",String(gp.top_p));
    if(gp.top_k!==undefined)ps.set("top_k",String(gp.top_k));
    if(gp.min_p!==undefined)ps.set("min_p",String(gp.min_p));
    if(gp.repetition_penalty!==undefined)ps.set("repetition_penalty",String(gp.repetition_penalty));
    if(gp.tools_format!=="default")ps.set("tools_format",gp.tools_format);
    if(suite!=="general")ps.set("suite",suite);
    const src=new EventSource(`/api/run?${ps}`);esRef.current=src;
    src.onmessage=msg=>{try{const e=JSON.parse(msg.data) as RunEvent;switch(e.type){case"scenario_started":setCurSc(e.scenarioId);break;case"model_progress":upCell(e.modelId,e.scenarioId,p=>({...p,phase:"running"}));break;case"scenario_result":upCell(e.modelId,e.scenarioId,()=>({phase:"done",result:e.result}));break;case"run_finished":setStatus("done");setScores(e.scores);saveResults(e.scores);src.close();esRef.current=null;setTimeout(()=>captureAll(),500);break;case"run_error":setStatus("error");setErrorMsg(e.message);src.close();esRef.current=null;break;}}catch{/* malformed SSE event — ignore */}};
    src.onerror=()=>{if(esRef.current){setStatus("error");setErrorMsg("Connection lost. Check the server.");esRef.current.close();esRef.current=null;}};
  }

  /* Start session with selected models */
  function startSession() {
    const ids = Array.from(selectedModelIds);
    if (ids.length === 0) return;
    setSessionOpen(false);
    run(undefined, ids);
  }

  /* Cell renderer */
  function C(model: PublicModelConfig, sc: ScenarioCard) {
    const c=cells[model.id]?.[sc.id];
    if(c?.phase==="running") return <div className="cell c-running"><span className="spinner-sm"/></div>;
    if(c?.result){const s=c.result.status;const to=s!=="pass"&&s!=="partial"&&isTimeout(c.result.summary);const cls=s==="pass"?"c-pass":s==="partial"?"c-partial":to?"c-timeout":"c-fail";const st=s==="pass"?"pass":s==="partial"?"partial":to?"timeout":"fail";return <button className={`cell c-btn ${cls}`} onClick={()=>setTrace({modelName:extractLabel(model.model),scenarioId:sc.id,summary:c.result?.summary??"",rawLog:c.result?.rawLog??""})}><StatusIcon s={st}/></button>;}
    return <div className="cell c-idle"/>;
  }

  /* Scenario lookup */
  const scMap = useMemo(()=>Object.fromEntries(activeScenarios.map(s=>[s.id,s])),[activeScenarios]);

  /* Categorized scenarios */
  const cats = useMemo(()=>{const g:Record<string,ScenarioCard[]>={};for(const s of activeScenarios)(g[s.category]??=[]).push(s);return g;},[activeScenarios]);

  /* Leaderboard rows */
  const lbRows = useMemo(()=>{
    if(ranked.length>0) return ranked.map(({m,s},i)=>({rank:i+1,model:m.model,provider:m.provider,score:s.finalScore,latency:s.avgLatencyMs>0?fmtLat(s.avgLatencyMs):"—",context:m.metadata?.contextWindow?(m.metadata.contextWindow>=1000?`${Math.round(m.metadata.contextWindow/1024)}K`:`${m.metadata.contextWindow}`):"—",cost:m.metadata?.costPerMillionInput?((()=>{const c=(15*500*m.metadata.costPerMillionInput!/1e6)+(15*200*(m.metadata.costPerMillionOutput??m.metadata.costPerMillionInput!)/1e6);return c<.01?"<$0.01":`$${c.toFixed(2)}`;})()):"Local",badge:i===0?"gold":i===1?"silver":i===2?"bronze":"",demo:false}));
    // Compute scores from demo grid and sort by score
    const demoRows = DEMO_MODELS.map(m=>({model:m,provider:DEMO_PROVIDERS[m],score:computeDemoScore(m,suite),latency:DEMO_LATENCY[m]??"—",context:DEMO_CTX[m]??"—",cost:DEMO_COST[m]??"—"})).sort((a,b)=>b.score-a.score);
    return demoRows.map((r,i)=>({rank:i+1,...r,badge:i===0?"gold":i===1?"silver":i===2?"bronze":"",demo:true}));
  },[ranked]);

  const isDemo = !hasModels && ranked.length === 0;

  return (
    <>
      {/* ── Top bar ── */}
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-brand">HERMES BENCH</span>
          <span className="topbar-sep"/>
          <div className="topbar-status"><span className={`dot dot-${status}`}/>{status==="idle"?"Ready":status==="running"?curSc:status==="done"?"Done":errorMsg||"Error"}</div>
          <span className="topbar-sep"/>
          <span className="topbar-status">{hasModels?`${allModels.length} models`:"No models"} · {activeScenarios.length} {suite==="business"?"EC":suite==="memory"?"MR":"TC"} · {suite} · {gp.tools_format}</span>
        </div>
        <div className="topbar-right">
          {status==="done"&&<><button className="btn" onClick={exportJson}><Download size={13}/>Export</button><button className="btn" onClick={captureAll}><Camera size={13}/>{screenshotMsg||"Screenshot"}</button></>}
          <button className="btn" onClick={()=>setCfgOpen(true)}><SlidersHorizontal size={13}/>Configure</button>
          <button className="btn btn-primary" onClick={()=>{if(hasModels){setSelectedModelIds(new Set(allModels.map(m=>m.id)));setSessionOpen(true);}}} disabled={!hasModels||status==="running"}><Play size={13}/>{status==="running"?"Running...":"New Session"}</button>
        </div>
      </div>

      {configError && <div style={{padding:"8px 12px",background:"rgba(239,68,68,.1)",borderRadius:6,color:"#ef4444",fontSize:12,marginBottom:10}}>{configError}</div>}

      {/* ── View tabs ── */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,flexWrap:"wrap"}}>
        <div className="view-tabs" style={{marginBottom:0}}>
          <button className={`view-tab ${view==="grid"?"view-tab-active":""}`} onClick={()=>setView("grid")}>Model Test</button>
          <button className={`view-tab ${view==="leaderboard"?"view-tab-active":""}`} onClick={()=>setView("leaderboard")}>Leaderboard</button>
          <button className={`view-tab ${view==="hardware"?"view-tab-active":""}`} onClick={()=>setView("hardware")}><Monitor size={12} style={{marginRight:4,verticalAlign:-1}}/>My Hardware</button>
        </div>
        <div className="suite-toggle">
          <button className={`suite-btn ${suite==="general"?"suite-btn-active":""}`} onClick={()=>setSuite("general")}>General</button>
          <button className={`suite-btn ${suite==="business"?"suite-btn-active":""}`} onClick={()=>setSuite("business")}>Business</button>
          <button className={`suite-btn ${suite==="memory"?"suite-btn-active":""}`} onClick={()=>setSuite("memory")}>Memory</button>
        </div>
      </div>

      {/* ══ GRID VIEW ══ */}
      {view === "grid" && (
        <div ref={gridRef}>
          <div className="grid-wrap">
            <div className="grid-header">
              <span className="grid-title">Results Matrix</span>
              {isDemo && <span className="sample-tag">Sample</span>}
            </div>
            <div className="grid-scroll">
              <table className="grid-table">
                <thead><tr>
                  <th>Model</th>
                  {activeScenarios.map(s=>{const info=scMap[s.id];return <th key={s.id} className="th-tip-wrap"><button className={`th-btn ${expandedTc===s.id?"th-active":""}`} onClick={e=>{if(e.shiftKey&&hasModels){run(s.id);}else setExpandedTc(expandedTc===s.id?null:s.id);}}>{s.id.replace(/^[A-Z]+-/,"")}</button><div className="th-tip"><div className="th-tip-id">{s.id} · Cat {info?.category}</div><div className="th-tip-title">{info?.title}</div><div className="th-tip-desc">{info?.description}</div></div></th>;})}
                  <th className="th-score">Score</th>
                </tr></thead>
                <tbody>
                  {hasModels ? dall.map(m=>{
                    const modelCells = activeScenarios.map(s => cells[m.id]?.[s.id]);
                    const pts = modelCells.reduce((sum, c) => sum + (c?.result?.points ?? 0), 0);
                    const max = activeScenarios.length * 2;
                    const pct = max > 0 ? Math.round((pts / max) * 100) : 0;
                    return (
                    <tr key={m.id}>
                      <td><span className="grid-model">{m.model}</span></td>
                      {activeScenarios.map(s=><td key={s.id}>{C(m,s)}</td>)}
                      <td className="td-score"><div className="grid-score-wrap"><div className="grid-score-bar" style={{width:`${pct}%`}}/><span className="grid-score-pct">{status==="done"?`${pct}%`:"—"}</span></div></td>
                    </tr>);
                  }) : DEMO_MODELS.map(name=>{
                    const pct = computeDemoScore(name, suite);
                    return (
                    <tr key={name}>
                      <td><span className="grid-model">{name}</span></td>
                      {activeScenarios.map(s=>{const demoGrid=DEMO_RESULTS[suite];const st=demoGrid?.[name]?.[s.id]??"fail";return <td key={s.id}><div className={`cell c-${st}`}><StatusIcon s={st}/></div></td>;})}
                      <td className="td-score"><div className="grid-score-wrap"><div className="grid-score-bar" style={{width:`${pct}%`}}/><span className="grid-score-pct">{pct}%</span></div></td>
                    </tr>);
                  })}
                </tbody>
              </table>
            </div>
            <div className="legend">
              <span className="legend-item"><span className="legend-dot c-pass"/> Pass</span>
              <span className="legend-item"><span className="legend-dot c-partial"/> Partial</span>
              <span className="legend-item"><span className="legend-dot c-fail"/> Fail</span>
              <span className="legend-item"><span className="legend-dot c-timeout"/> Timeout</span>
              {isDemo && <span className="legend-hint">All models testable with one OpenRouter API key — click Configure to set up</span>}
            </div>
          </div>

          {/* TC accordion */}
          <div className="tc-section">
            <div className="tc-section-header"><span className="grid-title">Test Cases</span><span className="grid-title">15 scenarios · 5 categories</span></div>
            {(Object.keys(suite==="business"?ENTERPRISE_CATEGORY_LABELS:suite==="memory"?MEMORY_CATEGORY_LABELS:CATEGORY_LABELS) as BenchmarkCategory[]).map(cat=>{const catLabels=suite==="business"?ENTERPRISE_CATEGORY_LABELS:suite==="memory"?MEMORY_CATEGORY_LABELS:CATEGORY_LABELS;return(
              <div key={cat} className="tc-cat-group">
                <div className="tc-cat-row">
                  <span className="tc-cat-tag">{cat}</span>
                  <span className="tc-cat-name">{catLabels[cat]}</span>
                  <span className="tc-cat-desc">{CAT_DESC[suite]?.[cat] ?? ""}</span>
                </div>
                {(cats[cat]??[]).map(sc=>{const open=expandedTc===sc.id;return(
                  <div key={sc.id} className="tc-row">
                    <button className="tc-row-btn" onClick={()=>setExpandedTc(open?null:sc.id)}>
                      <span className="tc-row-id">{sc.id}</span>
                      <span className="tc-row-title">{sc.title}</span>
                      <span className="tc-row-chevron">{open?"−":"+"}</span>
                    </button>
                    {open&&<div className="tc-expand">
                      <p className="tc-prompt">&ldquo;{sc.userMessage}&rdquo;</p>
                      <div className="tc-meta">
                        <div><strong>Tests</strong>{sc.description}</div>
                        <div><strong>Pass</strong>{sc.successCase}</div>
                        <div><strong>Fail</strong>{sc.failureCase}</div>
                      </div>
                    </div>}
                  </div>
                );})}
              </div>
            );})}
          </div>
        </div>
      )}

      {/* ══ LEADERBOARD VIEW ══ */}
      {view === "leaderboard" && (
        <div className="grid-wrap">
          <div className="grid-header">
            <span className="grid-title">Rankings</span>
            {isDemo && <span className="sample-tag">Sample</span>}
          </div>
          <table className="lb-table">
            <thead><tr>
              <th>#</th><th>Model</th><th>Provider</th>
              <th><Zap size={11}/>Score</th><th><Clock size={11}/>Latency</th>
              <th><Layers size={11}/>Context</th><th><DollarSign size={11}/>Cost</th>
            </tr></thead>
            <tbody>{lbRows.map(r=>(
              <tr key={`${r.rank}-${r.model}`} className={r.badge?`rank-${r.badge}`:""}>
                <td className="lb-rank">{r.badge==="gold"?"🥇":r.badge==="silver"?"🥈":r.badge==="bronze"?"🥉":r.rank}</td>
                <td className="lb-model">{r.model}</td>
                <td className="lb-provider">{r.provider}</td>
                <td><div className="lb-score-wrap"><div className="lb-bar" style={{width:`${r.score}%`}}/><span className="lb-pct">{r.score}%</span></div></td>
                <td>{r.latency}</td><td>{r.context}</td><td>{r.cost}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* ══ HARDWARE VIEW ══ */}
      {view === "hardware" && (
        <>
          <div className="grid-wrap">
            <div className="grid-header">
              <span className="grid-title">System Specs</span>
              <button className="btn" onClick={scanHardware} style={{padding:"3px 10px",fontSize:11}}><Cpu size={11}/>Re-scan</button>
            </div>
            {hwInfo ? (
              <div className="hw-specs">
                {hwInfo.modelName && <div className="hw-spec-item"><span className="hw-spec-label">Machine</span><span className="hw-spec-value">{hwInfo.modelName}</span></div>}
                <div className="hw-spec-item"><span className="hw-spec-label">Chip</span><span className="hw-spec-value">{hwInfo.chip || hwInfo.gpu || "Unknown"}</span></div>
                <div className="hw-spec-item"><span className="hw-spec-label">RAM</span><span className="hw-spec-value">{hwInfo.estimatedRam} GB{hwInfo.unifiedMemory ? " (unified)" : ""}</span></div>
                <div className="hw-spec-item"><span className="hw-spec-label">CPU Cores</span><span className="hw-spec-value">{hwInfo.cpuCores ?? "Unknown"}</span></div>
                <div className="hw-spec-item"><span className="hw-spec-label">GPU</span><span className="hw-spec-value">{hwInfo.gpu ?? "Not detected"}</span></div>
                {hwInfo.gpuVram && <div className="hw-spec-item"><span className="hw-spec-label">VRAM</span><span className="hw-spec-value">{hwInfo.gpuVram}</span></div>}
                {hwInfo.osVersion && <div className="hw-spec-item"><span className="hw-spec-label">OS</span><span className="hw-spec-value">{hwInfo.platform} {hwInfo.osVersion}</span></div>}
                <div className="hw-spec-item"><span className="hw-spec-label">Scan</span><span className="hw-spec-value" style={{color: hwInfo.scanSource === "server" ? "var(--green)" : "var(--amber)"}}>{hwInfo.scanSource === "server" ? "System scan (accurate)" : "Browser estimate (limited)"}</span></div>
                {hwInfo.unifiedMemory && <div className="hw-spec-note">Apple Silicon unified memory — all {hwInfo.estimatedRam}GB available as VRAM for local inference.</div>}
              </div>
            ) : <div className="hw-specs"><div className="hw-spec-note">Scanning system hardware...</div></div>}
          </div>

          <div className="grid-wrap" style={{marginTop:12}}>
            <div className="grid-header">
              <span className="grid-title">Model Compatibility — {hwModels.filter(m=>m.compatibility==="local").length} local, {hwModels.filter(m=>m.compatibility==="tight").length} tight, {hwModels.filter(m=>m.compatibility==="cloud-only").length} cloud</span>
              <div style={{display:"flex",gap:12,fontSize:10,fontFamily:"var(--mono)",color:"var(--text-4)"}}>
                <span><span className="hw-dot hw-dot-local"/> Local</span>
                <span><span className="hw-dot hw-dot-tight"/> Tight</span>
                <span><span className="hw-dot hw-dot-cloud"/> Cloud</span>
              </div>
            </div>
            <table className="lb-table">
              <thead><tr><th style={{width:28}}></th><th>Model</th><th>Size</th><th>Min RAM</th><th>Quant</th><th>Run With</th><th>Status</th></tr></thead>
              <tbody>{hwModels.map(m=>(
                <tr key={m.id}>
                  <td style={{textAlign:"center"}}><span className={`hw-dot hw-dot-${m.compatibility==="local"?"local":m.compatibility==="tight"?"tight":"cloud"}`}/></td>
                  <td className="lb-model">{m.name}</td>
                  <td>{m.params}</td>
                  <td style={{fontFamily:"var(--mono)"}}>{m.minRamGb>0?`${m.minRamGb}GB`:"—"}</td>
                  <td style={{fontFamily:"var(--mono)",fontSize:11}}>{m.quantization}</td>
                  <td style={{fontSize:11}}>{m.ollamaTag&&<span className="hw-ptag">ollama</span>}{m.openrouterId&&<span className="hw-ptag hw-ptag-cloud">cloud</span>}</td>
                  <td><span className={`hw-badge hw-badge-${m.compatibility}`}>{m.compatibility==="local"?"Run Locally":m.compatibility==="tight"?"Tight Fit":"Cloud Only"}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          <div className="grid-wrap" style={{marginTop:12}}>
            <div className="grid-header"><span className="grid-title">Quick Start</span></div>
            <div className="hw-quickstart">
              {hwModels.filter(m=>m.compatibility==="local"&&m.ollamaTag).length>0?(
                <div className="hw-qs-block">
                  <strong>Recommended local model for your machine:</strong>
                  <code className="hw-qs-code">{`ollama pull ${hwModels.find(m=>m.compatibility==="local"&&m.ollamaTag)?.ollamaTag}`}</code>
                  <span className="hw-qs-hint">Then add <code>ollama:{hwModels.find(m=>m.compatibility==="local"&&m.ollamaTag)?.ollamaTag}</code> in Configure → Models</span>
                </div>
              ):(
                <div className="hw-qs-block">
                  <strong>Your hardware is best suited for cloud models.</strong>
                  <span className="hw-qs-hint">Add your OpenRouter API key in Configure → API Keys, then use <code>openrouter:openai/gpt-4.1</code></span>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ══ HERMES SETUP GUIDE (inside hardware view) ══ */}
      {view === "hardware" && (
        <div className="grid-wrap" style={{marginTop:12}}>
          <div className="grid-header"><span className="grid-title">Hermes Agent Setup Guide</span><a href="https://hermes-agent.nousresearch.com/docs/getting-started/quickstart" target="_blank" rel="noopener" className="btn" style={{padding:"3px 10px",fontSize:10,textDecoration:"none"}}>Full Docs</a></div>

          <div className="hw-guide">
            <div className="hw-guide-section">
              <h3>Install Hermes Agent</h3>
              <code className="hw-qs-code">curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash</code>
              <span className="hw-qs-hint">Then reload your shell: <code>source ~/.zshrc</code> or <code>source ~/.bashrc</code></span>
            </div>

            <div className="hw-guide-section">
              <h3>Add a Model Provider</h3>
              <p className="hw-guide-desc">Run <code>hermes model</code> to pick interactively, or configure directly:</p>
              <div className="hw-guide-grid">

                <div className="hw-guide-card">
                  <strong>Ollama (Local)</strong>
                  <code className="hw-qs-code">{`ollama pull hermes3:8b\nollama serve`}</code>
                  <span className="hw-guide-yaml">config.yaml:</span>
                  <code className="hw-qs-code">{`model:\n  default: hermes3:8b\n  provider: custom\n  base_url: http://localhost:11434/v1\n  context_length: 32768`}</code>
                  <span className="hw-guide-warn">Ollama defaults to 4K context. Set it explicitly or run:<br/><code>OLLAMA_CONTEXT_LENGTH=32768 ollama serve</code></span>
                </div>

                <div className="hw-guide-card">
                  <strong>vLLM (GPU Server)</strong>
                  <code className="hw-qs-code">{`vllm serve NousResearch/Hermes-3-Llama-3.1-8B \\\n  --port 8000 \\\n  --enable-auto-tool-choice \\\n  --tool-call-parser hermes \\\n  --max-model-len 32768`}</code>
                  <span className="hw-guide-warn">Both <code>--enable-auto-tool-choice</code> and <code>--tool-call-parser hermes</code> are required for tool calling to work.</span>
                </div>

                <div className="hw-guide-card">
                  <strong>llama.cpp (CPU/Metal)</strong>
                  <code className="hw-qs-code">{`./llama-server \\\n  --jinja -fa \\\n  -c 32768 -ngl 99 \\\n  -m Hermes-3-8B-Q4_K_M.gguf \\\n  --port 8080 --host 0.0.0.0`}</code>
                  <span className="hw-guide-warn">The <code>--jinja</code> flag is required. Without it, tool calls are silently ignored.</span>
                </div>

                <div className="hw-guide-card">
                  <strong>OpenRouter (Cloud)</strong>
                  <code className="hw-qs-code">{`# In ~/.hermes/.env:\nOPENROUTER_API_KEY=sk-or-...\n\n# Then:\nhermes chat --provider openrouter \\\n  --model nousresearch/hermes-3-llama-3.1-70b`}</code>
                  <span className="hw-guide-hint">Works with 200+ models. Append <code>:nitro</code> for faster routing.</span>
                </div>

              </div>
            </div>

            <div className="hw-guide-section">
              <h3>Common Issues & Fixes</h3>
              <div className="hw-guide-issues">
                <div className="hw-issue">
                  <strong>Tool calls appear as plain text</strong>
                  <span>Server isn't parsing tool calls. Fix: add <code>--jinja</code> (llama.cpp), <code>--enable-auto-tool-choice --tool-call-parser hermes</code> (vLLM), or <code>--tool-call-parser qwen</code> (SGLang). Ollama and LM Studio 0.3.6+ work out of the box.</span>
                </div>
                <div className="hw-issue">
                  <strong>Model forgets context mid-conversation</strong>
                  <span>Context window too small. Agent system prompt + tools use 4-8K tokens. Set at least <code>context_length: 32768</code> in config.yaml. Ollama users: set <code>OLLAMA_CONTEXT_LENGTH=32768</code>.</span>
                </div>
                <div className="hw-issue">
                  <strong>Responses get cut off / truncated</strong>
                  <span>SGLang defaults to 128 max output tokens — add <code>--default-max-tokens 4096</code>. Or enable context compression in Hermes config.</span>
                </div>
                <div className="hw-issue">
                  <strong>Connection refused (WSL2 on Windows)</strong>
                  <span>WSL2 uses a virtual network. Either enable mirrored networking in <code>.wslconfig</code>, or use your host IP instead of localhost. Servers must bind to <code>0.0.0.0</code>, not <code>127.0.0.1</code>.</span>
                </div>
                <div className="hw-issue">
                  <strong>Which model should I use?</strong>
                  <span>For tool calling: Hermes 3 8B (local, 6GB+ RAM), Hermes 3 70B (cloud or 48GB+), Qwen 3 32B (strong reasoning). For general: GPT-4.1 or Claude Sonnet 4 via OpenRouter.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <SessionDialog open={sessionOpen} onClose={()=>setSessionOpen(false)} models={allModels} selected={selectedModelIds} setSelected={setSelectedModelIds} onStart={startSession}/>
      <AdminDialog open={cfgOpen} onClose={()=>setCfgOpen(false)} gp={gp} setGp={setGp}/>
      <TraceDialog details={trace} onClose={()=>setTrace(null)}/>
    </>
  );
}
