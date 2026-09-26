"use client";

import { useState } from "react";

type Result = {
  prototype: boolean;
  provider: string;
  model: string;
  route: string;
  latencyMs: number;
  succeededAt: string;
  understanding: Record<string, unknown>;
  gate: { outcome: string; reason: string };
};

const SAMPLE =
  "A거래처에서 산업용 필터 30개 견적을 금요일 오전까지 요청했습니다. 담당자 확인 후 이메일 회신이 필요합니다.";

export default function Home() {
  const [text, setText] = useState(SAMPLE);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Request failed");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const u = result?.understanding ?? {};

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <div className="eyebrow">FlowFit Judge Demo</div>
          <h1>Verified AI execution infrastructure</h1>
          <p className="lede">
            A narrow, working prototype for the Nebius × NVIDIA Global AI Hackathon.
            The model interprets the work; deterministic policy keeps execution authority separate.
          </p>
        </div>
        <div className="statusRow">
          <span className="chip">Prototype · Active development</span>
          <span className={result ? "chip live" : "chip ready"}>{result ? "LIVE" : "READY"}</span>
        </div>
      </section>

      <section className="panel">
        <div className="panelTitle">1. Business request</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
        <button onClick={run} disabled={loading || !text.trim()}>
          {loading ? "Calling Nemotron…" : "Run through FlowFit"}
        </button>
        {error ? <div className="error">{error}</div> : null}
      </section>
      <section className="grid2">
        <div className="panel">
          <div className="panelTitle">2. Task Understanding</div>
          {result ? (
            <div className="kv">
              <div><span>Provider</span><b>{result.provider}</b></div>
              <div><span>Model</span><b title={result.model}>{result.model}</b></div>
              <div><span>Latency</span><b>{result.latencyMs} ms</b></div>
              <div><span>Route</span><b>{result.route}</b></div>
              <div><span>Task type</span><b>{String(u.taskType ?? "—")}</b></div>
              <div><span>Confidence</span><b>{u.confidence != null ? Math.round(Number(u.confidence) * 100) + "%" : "—"}</b></div>
              <div><span>Risk</span><b>{String(u.riskLevel ?? "—")}</b></div>
              <div><span>Title</span><b>{String(u.title ?? "—")}</b></div>
            </div>
          ) : (
            <p className="muted">A successful live Nebius inference will appear here.</p>
          )}
        </div>

        <div className="panel">
          <div className="panelTitle">3. Deterministic Gate</div>
          {result ? (
            <>
              <div className="gate">{result.gate.outcome}</div>
              <p className="muted">{result.gate.reason}</p>
              <div className="boundary">
                <b>Model recommendation ≠ Action authorization</b>
                <span>This judge demo never gives the LLM execution authority.</span>
              </div>
            </>
          ) : (
            <p className="muted">The policy gate runs after task understanding.</p>
          )}
        </div>
      </section>
      <section className="panel flow">
        <div className="panelTitle">4. FlowFit boundary</div>
        <div className="steps">
          <span>Nebius / Nemotron</span><i>→</i>
          <span>Task Understanding</span><i>→</i>
          <span>Context</span><i>→</i>
          <span>Decision</span><i>→</i>
          <span>AutonomyGate</span><i>→</i>
          <span>Human Approval</span><i>→</i>
          <span>ExecutionAuthority</span>
        </div>
        <p className="foot">
          The public judge demo exercises the real Nebius/Nemotron understanding call and a deterministic policy gate.
          The full FlowFit repository contains the broader prototype workflow under active development.
        </p>
      </section>
    </main>
  );
}
