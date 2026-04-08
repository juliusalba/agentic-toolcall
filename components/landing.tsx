"use client";

import { useEffect, useRef } from "react";

export function Landing() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = window.innerWidth;
    let H = window.innerHeight;
    let animId: number;

    function resize() {
      W = canvas!.width = window.innerWidth;
      H = canvas!.height = window.innerHeight;
    }
    window.addEventListener("resize", resize);
    resize();

    const NODES = 120;
    const CONNECT_DIST = 200;
    const nodes: { x: number; y: number; vx: number; vy: number; r: number; type: string; phase: number; speed: number }[] = [];

    for (let i = 0; i < NODES; i++) {
      nodes.push({
        x: Math.random() * W,
        y: Math.random() * H * 3,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 2.5 + 1,
        type: Math.random() < 0.2 ? "hex" : Math.random() < 0.35 ? "ring" : "dot",
        phase: Math.random() * Math.PI * 2,
        speed: 0.3 + Math.random() * 0.7,
      });
    }

    const shapes: { x: number; y: number; size: number; rotation: number; rotSpeed: number; vy: number; vx: number; type: string; alpha: number }[] = [];
    for (let i = 0; i < 24; i++) {
      shapes.push({
        x: Math.random() * W,
        y: Math.random() * H * 3,
        size: 40 + Math.random() * 120,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.008,
        vy: -0.15 - Math.random() * 0.25,
        vx: (Math.random() - 0.5) * 0.2,
        type: ["triangle", "diamond", "hexagon", "circle"][Math.floor(Math.random() * 4)],
        alpha: 0.04 + Math.random() * 0.08,
      });
    }

    let scrollY = 0;
    const onScroll = () => { scrollY = window.scrollY; };
    window.addEventListener("scroll", onScroll);

    function drawHexagon(cx: number, cy: number, r: number) {
      ctx!.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const px = cx + r * Math.cos(a);
        const py = cy + r * Math.sin(a);
        i === 0 ? ctx!.moveTo(px, py) : ctx!.lineTo(px, py);
      }
      ctx!.closePath();
    }

    function drawShape(s: typeof shapes[0], t: number) {
      const x = s.x, y = s.y - scrollY * 0.3;
      if (y < -100 || y > H + 100) return;
      ctx!.save();
      ctx!.translate(x, y);
      ctx!.rotate(s.rotation + t * s.rotSpeed * 60);
      ctx!.globalAlpha = s.alpha * 1.8;
      ctx!.strokeStyle = "#3b82f6";
      ctx!.lineWidth = 1.5;
      switch (s.type) {
        case "triangle":
          ctx!.beginPath();
          ctx!.moveTo(0, -s.size / 2);
          ctx!.lineTo(-s.size / 2, s.size / 2);
          ctx!.lineTo(s.size / 2, s.size / 2);
          ctx!.closePath();
          ctx!.stroke();
          break;
        case "diamond":
          ctx!.beginPath();
          ctx!.moveTo(0, -s.size / 2);
          ctx!.lineTo(-s.size / 3, 0);
          ctx!.lineTo(0, s.size / 2);
          ctx!.lineTo(s.size / 3, 0);
          ctx!.closePath();
          ctx!.stroke();
          break;
        case "hexagon":
          drawHexagon(0, 0, s.size / 2);
          ctx!.stroke();
          break;
        case "circle":
          ctx!.beginPath();
          ctx!.arc(0, 0, s.size / 2, 0, Math.PI * 2);
          ctx!.stroke();
          break;
      }
      ctx!.restore();
    }

    let time = 0;
    function frame() {
      time += 0.016;
      ctx!.clearRect(0, 0, W, H);

      for (const s of shapes) {
        s.x += s.vx;
        s.y += s.vy;
        s.rotation += s.rotSpeed;
        if (s.y - scrollY * 0.3 < -200) { s.y = H + scrollY * 0.3 + 200; s.x = Math.random() * W; }
        drawShape(s, time);
      }

      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < -200 || n.y > H * 3 + 200) n.vy *= -1;
        const sy = n.y - scrollY * 0.5;
        if (sy < -50 || sy > H + 50) continue;
        const pulse = Math.sin(time * n.speed + n.phase) * 0.5 + 0.5;
        const alpha = 0.3 + pulse * 0.35;
        const accentRGB = "59,130,246";
        const greenRGB = "34,197,94";

        for (const m of nodes) {
          const my = m.y - scrollY * 0.5;
          if (my < -50 || my > H + 50) continue;
          const dx = n.x - m.x, dy = sy - my;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < CONNECT_DIST && d > 0) {
            ctx!.strokeStyle = `rgba(${accentRGB},${(1 - d / CONNECT_DIST) * 0.14})`;
            ctx!.lineWidth = 0.7;
            ctx!.beginPath();
            ctx!.moveTo(n.x, sy);
            ctx!.lineTo(m.x, my);
            ctx!.stroke();
          }
        }

        if (n.type === "hex") {
          ctx!.globalAlpha = alpha * 0.8;
          ctx!.strokeStyle = `rgba(${greenRGB},1)`;
          ctx!.lineWidth = 1.5;
          drawHexagon(n.x, sy, n.r * 5);
          ctx!.stroke();
        } else if (n.type === "ring") {
          ctx!.globalAlpha = alpha * 0.7;
          ctx!.strokeStyle = `rgba(${accentRGB},1)`;
          ctx!.lineWidth = 1.2;
          ctx!.beginPath();
          ctx!.arc(n.x, sy, n.r * 4, 0, Math.PI * 2);
          ctx!.stroke();
        } else {
          ctx!.globalAlpha = alpha;
          ctx!.fillStyle = `rgba(${accentRGB},1)`;
          ctx!.beginPath();
          ctx!.arc(n.x, sy, n.r * 1.5, 0, Math.PI * 2);
          ctx!.fill();
        }
      }

      ctx!.globalAlpha = 1;
      animId = requestAnimationFrame(frame);
    }

    frame();
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="landing-canvas" />
      <div className="landing-wrap">
        {/* Nav */}
        <nav className="landing-nav">
          <div className="landing-nav-inner">
            <span className="landing-brand">HERMES AGENT BENCHMARK</span>
            <div className="landing-links">
              <a href="#features">Features</a>
              <a href="#demo">Demo</a>
              <a href="#suites">Test Suites</a>
              <a href="#compatibility">Hermes Compat</a>
              <a href="https://github.com/juliusalba/agentic-toolcall" target="_blank" rel="noopener">GitHub</a>
            </div>
          </div>
        </nav>

        {/* Hero */}
        <section className="landing-hero">
          <div className="landing-badge">Open Source</div>
          <h1>Find the best AI model<br />for <span>Hermes Agent</span></h1>
          <p>
            Test 10+ LLMs across 45 scenarios. See which models handle tool calling,
            multi-step workflows, and memory retrieval — then check if your hardware can run them locally.
          </p>
          <div className="landing-actions">
            <a href="/engine" className="landing-btn-primary landing-btn-glow">Run Engine</a>
            <a href="https://github.com/juliusalba/agentic-toolcall" target="_blank" rel="noopener" className="landing-btn-secondary">View on GitHub</a>
          </div>
        </section>

        {/* Features */}
        <section className="landing-section" id="features">
          <div className="landing-label">Why This Exists</div>
          <h2>Not another generic benchmark</h2>
          <p className="landing-desc">
            Most benchmarks test general intelligence. This one tests what matters for AI agents:
            can the model use tools correctly, chain actions, and work inside Hermes Agent Engine?
          </p>
          <div className="landing-features">
            {[
              { icon: "\u2699", title: "45 Real Scenarios", desc: "Weather lookups, CRM pipelines, memory retrieval, error recovery, cron scheduling. Not toy examples — real agent tasks across 3 suites." },
              { icon: "\u2605", title: "Hermes Compatibility Scoring", desc: "Each model rated on 5 factors: native format support, system prompt adherence, multi-turn chains, Hermes features, and community verification." },
              { icon: "\u2328", title: '"Can I Run This?" Hardware Check', desc: "Auto-detects your CPU, RAM, GPU. Tells you in plain English which models run locally, accounting for your daily workload." },
              { icon: "\u2697", title: "Side-by-Side Comparison", desc: "10 models, 15 tests, one grid. Color-coded pass/partial/fail with live scoring, latency, context window, and cost estimates." },
              { icon: "\u2601", title: "Cloud + Local Providers", desc: "OpenRouter, Ollama, vLLM, llama.cpp, MLX, LM Studio. One API key tests everything — or run fully local." },
              { icon: "\u22EE", title: "Detailed Trace Logs", desc: "Click any cell to see every turn: what the model sent, which tools it called, what arguments it used, and where it went wrong." },
            ].map((f) => (
              <div key={f.title} className="landing-card">
                <div className="landing-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <hr className="landing-divider" />

        {/* Demo */}
        <section className="landing-section" id="demo">
          <div className="landing-label">See It In Action</div>
          <h2>Every view, explained</h2>
          <p className="landing-desc">
            The dashboard has three views: the test grid, the leaderboard, and the hardware checker.
          </p>
          <div className="landing-cta-mid">
            <a href="/engine" className="landing-btn-primary landing-btn-glow">Try It Now — Run Engine</a>
          </div>
        </section>

        <hr className="landing-divider" />

        {/* Test Suites */}
        <section className="landing-section" id="suites">
          <div className="landing-label">What We Test</div>
          <h2>3 suites, 45 scenarios</h2>
          <p className="landing-desc">Each suite targets a different agent capability. Models are scored 0-2 per scenario across 5 categories.</p>
          <div className="landing-suites">
            {[
              { name: "General (ToolCall-15)", count: "15 scenarios", items: ["A. Quick Lookups", "B. Parameter Precision", "C. Multi-Tool Chains", "D. Judgment & Refusal", "E. Error Recovery"] },
              { name: "Business / Enterprise", count: "15 scenarios", items: ["A. REST APIs & MCP", "B. CRM & Lead Gen", "C. Orchestration", "D. Skills & Cron", "E. Research & Analysis"] },
              { name: "Memory & Retrieval", count: "15 scenarios", items: ["A. Recall & Retrieval", "B. Memory Storage", "C. Query & Synthesis", "D. Hallucination Resistance", "E. Complex Memory Tasks"] },
            ].map((s) => (
              <div key={s.name} className="landing-suite">
                <h3>{s.name}</h3>
                <div className="landing-suite-count">{s.count}</div>
                <ul>{s.items.map((li) => <li key={li}>{li}</li>)}</ul>
              </div>
            ))}
          </div>
        </section>

        <hr className="landing-divider" />

        {/* Hermes Compatibility */}
        <section className="landing-section" id="compatibility">
          <div className="landing-label">Hermes Agent Engine</div>
          <h2>Not all models work the same in Hermes</h2>
          <p className="landing-desc">
            Generic benchmarks test tool calling in isolation. We test how well each model works{" "}
            <strong>specifically inside Hermes Agent Engine</strong> — the format, the features, the real workflow.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="landing-table">
              <thead>
                <tr><th>Factor</th><th>What It Measures</th><th>Why It Matters</th></tr>
              </thead>
              <tbody>
                <tr><td><strong>Format Support</strong></td><td>Native Hermes ChatML vs OpenAI JSON adapter</td><td>Native format = no translation layer, fewer parsing errors</td></tr>
                <tr><td><strong>System Prompt</strong></td><td>Follows Hermes system prompt conventions</td><td>Hermes Agent uses specific prompts — models must respect them</td></tr>
                <tr><td><strong>Multi-Turn Chains</strong></td><td>Sequential tool calls across conversation turns</td><td>Real agent tasks require 3-8 turns of tool use</td></tr>
                <tr><td><strong>Hermes Features</strong></td><td>Skill creation, cron scheduling, MCP, sub-agents</td><td>These are Hermes-specific — other frameworks don&apos;t have them</td></tr>
                <tr><td><strong>Community Tested</strong></td><td>Verified by real users in Hermes Agent</td><td>Lab results vs production reality</td></tr>
              </tbody>
            </table>
          </div>
          <div className="landing-badges">
            <span className="landing-badge-green">Excellent = Purpose-built (Hermes 3 family)</span>
            <span className="landing-badge-blue">Good = Reliable via adapter (GPT-4.1, Claude, Qwen 32B)</span>
            <span className="landing-badge-amber">Basic = Simple calls only (small models)</span>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="landing-section" style={{ textAlign: "center", paddingBottom: 120 }}>
          <h2>Ready to test?</h2>
          <p className="landing-desc" style={{ margin: "0 auto 32px" }}>No sign-up. No install. Click and go.</p>
          <a href="/engine" className="landing-btn-primary landing-btn-glow" style={{ fontSize: 20, padding: "18px 48px" }}>Run Engine</a>
        </section>

        {/* Footer */}
        <footer className="landing-footer">
          <p>
            Built on <a href="https://github.com/stevibe/toolcall-15" target="_blank" rel="noopener">ToolCall-15</a> by{" "}
            <a href="https://x.com/stevibe" target="_blank" rel="noopener">stevibe</a> &middot;{" "}
            <a href="https://github.com/juliusalba/agentic-toolcall" target="_blank" rel="noopener">GitHub</a> &middot; MIT License
          </p>
        </footer>
      </div>
    </>
  );
}
