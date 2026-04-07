"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Play, SlidersHorizontal, X, Zap, Clock, DollarSign, Layers, Save, Camera, CheckSquare, Square, Cpu, Monitor } from "lucide-react";
import html2canvas from "html2canvas-pro";

import { scoreModelResults, CATEGORY_LABELS, type BenchmarkCategory, type ModelScenarioResult, type ModelScoreSummary } from "@/lib/benchmark";
import { detectHardware, checkAllModels, type HardwareInfo, type ModelCompatResult } from "@/lib/hardware";
import type { PublicModelConfig } from "@/lib/models";
import type { RunEvent } from "@/lib/orchestrator";

/* ── Types ── */
type ScenarioCard = { id: string; title: string; category: BenchmarkCategory; description: string; userMessage: string; successCase: string; failureCase: string };
type DashboardProps = { primaryModels: PublicModelConfig[]; secondaryModels: PublicModelConfig[]; scenarios: ScenarioCard[]; configError?: string | null };
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
const DEMO_META: Record<string, { score: number; latency: string; context: string; cost: string }> = {
  "GPT-4.1":          { score: 93, latency: "1.2s", context: "1M",   cost: "$0.04" },
  "Claude Sonnet 4":  { score: 90, latency: "1.6s", context: "200K", cost: "$0.05" },
  "Gemma 3 27B":      { score: 85, latency: "1.8s", context: "128K", cost: "$0.01" },
  "Qwen 3 32B":       { score: 83, latency: "1.5s", context: "128K", cost: "$0.01" },
  "Hermes 3 70B":     { score: 80, latency: "2.4s", context: "128K", cost: "$0.02" },
  "GLM-4 32B":        { score: 77, latency: "2.1s", context: "128K", cost: "$0.01" },
  "MiniMax-M1":       { score: 73, latency: "2.8s", context: "1M",   cost: "$0.02" },
  "Xiaomi MiMo 7B":   { score: 60, latency: "0.8s", context: "128K", cost: "<$0.01" },
  "Hermes 3 8B":      { score: 57, latency: "0.9s", context: "128K", cost: "Free" },
  "DeepSeek V3":      { score: 87, latency: "1.3s", context: "128K", cost: "$0.01" },
};
// Demo results: easy TCs mostly pass, complexity separates the models
const DEMO_RESULTS: Record<string, Record<string, "pass" | "partial" | "fail">> = {
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
};

const CAT_DESC: Record<BenchmarkCategory, string> = {
  A: "Simple daily lookups — weather, stocks, common knowledge", B: "Get parameters exactly right — units, dates, multi-value", C: "Chain multiple tools — contact→email, parallel, conditional", D: "Judgment calls — mental math, refusals, 4-step workflows", E: "When things break — retries, errors, data integrity",
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

export function Dashboard({ primaryModels, secondaryModels, scenarios, configError }: DashboardProps) {
  const allModels = useMemo(() => [...primaryModels, ...secondaryModels], [primaryModels, secondaryModels]);
  const [cells, setCells] = useState(() => buildCells(allModels, scenarios));
  const cellsRef = useRef(cells);
  const [scores, setScores] = useState<Record<string, ModelScoreSummary>>({});
  const [status, setStatus] = useState<"idle"|"running"|"done"|"error">("idle");
  const [curSc, setCurSc] = useState(scenarios[0]?.id ?? "");
  const [expandedTc, setExpandedTc] = useState<string|null>(null);
  const [trace, setTrace] = useState<FailureDetails|null>(null);
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

  function scanHardware() {
    const hw = detectHardware();
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
    setStatus("running");setTrace(null);
    const ps=new URLSearchParams({models:runModels.map(m=>m.id).join(",")});
    if(tid)ps.set("scenarios",tid);
    if(gp.temperature!==0)ps.set("temperature",String(gp.temperature));
    if(gp.top_p!==undefined)ps.set("top_p",String(gp.top_p));
    if(gp.top_k!==undefined)ps.set("top_k",String(gp.top_k));
    if(gp.min_p!==undefined)ps.set("min_p",String(gp.min_p));
    if(gp.repetition_penalty!==undefined)ps.set("repetition_penalty",String(gp.repetition_penalty));
    if(gp.tools_format!=="default")ps.set("tools_format",gp.tools_format);
    const src=new EventSource(`/api/run?${ps}`);esRef.current=src;
    src.onmessage=msg=>{const e=JSON.parse(msg.data) as RunEvent;switch(e.type){case"scenario_started":setCurSc(e.scenarioId);break;case"model_progress":upCell(e.modelId,e.scenarioId,p=>({...p,phase:"running"}));break;case"scenario_result":upCell(e.modelId,e.scenarioId,()=>({phase:"done",result:e.result}));break;case"run_finished":setStatus("done");setScores(e.scores);src.close();esRef.current=null;setTimeout(()=>captureAll(),500);break;case"run_error":setStatus("error");src.close();esRef.current=null;break;}};
    src.onerror=()=>{if(esRef.current){setStatus("error");esRef.current.close();esRef.current=null;}};
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
  const scMap = useMemo(()=>Object.fromEntries(scenarios.map(s=>[s.id,s])),[scenarios]);

  /* Categorized scenarios */
  const cats = useMemo(()=>{const g:Record<string,ScenarioCard[]>={};for(const s of scenarios)(g[s.category]??=[]).push(s);return g;},[scenarios]);

  /* Leaderboard rows */
  const lbRows = useMemo(()=>{
    if(ranked.length>0) return ranked.map(({m,s},i)=>({rank:i+1,model:m.model,provider:m.provider,score:s.finalScore,latency:s.avgLatencyMs>0?fmtLat(s.avgLatencyMs):"—",context:m.metadata?.contextWindow?(m.metadata.contextWindow>=1000?`${Math.round(m.metadata.contextWindow/1024)}K`:`${m.metadata.contextWindow}`):"—",cost:m.metadata?.costPerMillionInput?((()=>{const c=(15*500*m.metadata.costPerMillionInput!/1e6)+(15*200*(m.metadata.costPerMillionOutput??m.metadata.costPerMillionInput!)/1e6);return c<.01?"<$0.01":`$${c.toFixed(2)}`;})()):"Local",badge:i===0?"gold":i===1?"silver":i===2?"bronze":"",demo:false}));
    return DEMO_MODELS.map((m,i)=>({rank:i+1,model:m,provider:DEMO_PROVIDERS[m],score:DEMO_META[m].score,latency:DEMO_META[m].latency,context:DEMO_META[m].context,cost:DEMO_META[m].cost,badge:i===0?"gold":i===1?"silver":i===2?"bronze":"",demo:true}));
  },[ranked]);

  const isDemo = !hasModels && ranked.length === 0;

  return (
    <>
      {/* ── Top bar ── */}
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-brand">HERMES BENCH</span>
          <span className="topbar-sep"/>
          <div className="topbar-status"><span className={`dot dot-${status}`}/>{status==="idle"?"Ready":status==="running"?curSc:status==="done"?"Done":"Error"}</div>
          <span className="topbar-sep"/>
          <span className="topbar-status">{hasModels?`${allModels.length} models`:"No models"} · 15 TC · {gp.tools_format}</span>
        </div>
        <div className="topbar-right">
          {status==="done"&&<button className="btn" onClick={captureAll}><Camera size={13}/>{screenshotMsg||"Screenshot"}</button>}
          <button className="btn" onClick={()=>setCfgOpen(true)}><SlidersHorizontal size={13}/>Configure</button>
          <button className="btn btn-primary" onClick={()=>{if(hasModels){setSelectedModelIds(new Set(allModels.map(m=>m.id)));setSessionOpen(true);}}} disabled={!hasModels||status==="running"}><Play size={13}/>{status==="running"?"Running...":"New Session"}</button>
        </div>
      </div>

      {configError && <div style={{padding:"8px 12px",background:"rgba(239,68,68,.1)",borderRadius:6,color:"#ef4444",fontSize:12,marginBottom:10}}>{configError}</div>}

      {/* ── View tabs ── */}
      <div className="view-tabs">
        <button className={`view-tab ${view==="grid"?"view-tab-active":""}`} onClick={()=>setView("grid")}>Model Test</button>
        <button className={`view-tab ${view==="leaderboard"?"view-tab-active":""}`} onClick={()=>setView("leaderboard")}>Leaderboard</button>
        <button className={`view-tab ${view==="hardware"?"view-tab-active":""}`} onClick={()=>setView("hardware")}><Monitor size={12} style={{marginRight:4,verticalAlign:-1}}/>My Hardware</button>
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
                  {scenarios.map(s=>{const info=scMap[s.id];return <th key={s.id} className="th-tip-wrap"><button className={`th-btn ${expandedTc===s.id?"th-active":""}`} onClick={e=>{if(e.shiftKey&&hasModels){run(s.id);}else setExpandedTc(expandedTc===s.id?null:s.id);}}>{s.id.replace("TC-","")}</button><div className="th-tip"><div className="th-tip-id">{s.id} · Cat {info?.category}</div><div className="th-tip-title">{info?.title}</div><div className="th-tip-desc">{info?.description}</div></div></th>;})}
                </tr></thead>
                <tbody>
                  {hasModels ? dall.map(m=>(
                    <tr key={m.id}>
                      <td><span className="grid-model">{m.model}</span></td>
                      {scenarios.map(s=><td key={s.id}>{C(m,s)}</td>)}
                    </tr>
                  )) : DEMO_MODELS.map(name=>(
                    <tr key={name}>
                      <td><span className="grid-model">{name}</span></td>
                      {scenarios.map(s=>{const st=DEMO_RESULTS[name]?.[s.id]??"fail";return <td key={s.id}><div className={`cell c-${st}`}><StatusIcon s={st}/></div></td>;})}
                    </tr>
                  ))}
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
            {(Object.keys(CATEGORY_LABELS) as BenchmarkCategory[]).map(cat=>(
              <div key={cat} className="tc-cat-group">
                <div className="tc-cat-row">
                  <span className="tc-cat-tag">{cat}</span>
                  <span className="tc-cat-name">{CATEGORY_LABELS[cat]}</span>
                  <span className="tc-cat-desc">{CAT_DESC[cat]}</span>
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
            ))}
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
                <div className="hw-spec-item"><span className="hw-spec-label">Platform</span><span className="hw-spec-value">{hwInfo.platform}{hwInfo.isAppleSilicon ? " (Apple Silicon)" : ""}</span></div>
                <div className="hw-spec-item"><span className="hw-spec-label">RAM (estimated)</span><span className="hw-spec-value">{hwInfo.estimatedRam} GB{hwInfo.ram ? ` (browser reports: ${hwInfo.ram} GB)` : ""}</span></div>
                <div className="hw-spec-item"><span className="hw-spec-label">CPU Cores</span><span className="hw-spec-value">{hwInfo.cpuCores ?? "Unknown"}</span></div>
                <div className="hw-spec-item"><span className="hw-spec-label">GPU</span><span className="hw-spec-value">{hwInfo.gpu ?? "Not detected"}</span></div>
                {hwInfo.isAppleSilicon && <div className="hw-spec-note">Apple Silicon unified memory — RAM acts as VRAM for local inference.</div>}
              </div>
            ) : <div className="hw-specs"><div className="hw-spec-note">Scanning...</div></div>}
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

      <SessionDialog open={sessionOpen} onClose={()=>setSessionOpen(false)} models={allModels} selected={selectedModelIds} setSelected={setSelectedModelIds} onStart={startSession}/>
      <AdminDialog open={cfgOpen} onClose={()=>setCfgOpen(false)} gp={gp} setGp={setGp}/>
      <TraceDialog details={trace} onClose={()=>setTrace(null)}/>
    </>
  );
}
