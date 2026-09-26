# FlowFit — Verified Execution Infrastructure for AI Agents

**Status:** Prototype / active development  
**Hackathon track:** Best Apps and Agents  
**AI runtime:** Nebius Token Factory + NVIDIA Nemotron 3 Super

FlowFit turns messy business requests into controlled operational workflows.

The system separates probabilistic AI reasoning from deterministic authorization and execution controls.

## Problem

A useful business agent must do more than generate an answer.

It must know what evidence supports an action, whether the action is allowed, whether human approval is required, whether execution actually succeeded, and what to do when it fails.

FlowFit is designed around that execution gap.

## Current pipeline

```text
Intake
→ Task Understanding
→ Context Matching
→ Decision Engine
→ AutonomyGate
→ Human Approval when required
→ ExecutionAuthority
→ Connector / Device execution
→ Recovery
→ Timeline / Audit
```

## Nebius × NVIDIA integration

For the hackathon build, FlowFit adds Nebius Token Factory as a first-class AI provider and uses:

```text
nvidia/nemotron-3-super-120b-a12b
```

Nemotron currently powers the task-understanding stage and is also available through the shared agent-model provider layer.

The model does **not** directly authorize sensitive actions.

FlowFit keeps authorization, approval requirements, execution policy, and recovery outside the LLM.

The admin UI exposes a runtime evidence panel showing:

- provider
- exact model ID
- last successful route
- measured request latency
- last successful call time
- LIVE only after a real successful runtime call

The panel is explicitly labeled **Prototype · Active development**.

## Significant update during the hackathon period

FlowFit existed before the submission period. The repository began in July 2026.

After the hackathon submission period opened on **August 26, 2026**, the project was significantly updated to add the Nebius/NVIDIA runtime path rather than simply rebranding the existing system.

The hackathon-period update includes:

1. Nebius Token Factory provider support in the shared model layer.
2. NVIDIA Nemotron 3 Super integration for structured task understanding.
3. OpenAI-compatible tool-call translation for the Nebius provider path.
4. Runtime telemetry that records real provider, model, route, latency, and successful-call time.
5. A UI evidence panel that changes from READY to LIVE only after an actual Nebius inference succeeds.
6. Integration with the existing FlowFit Decision Engine, AutonomyGate, approval, ExecutionAuthority, and recovery flow.
7. Runner/UI authentication fallback so the existing local development stack can use the same protected Runner without copying API keys between projects.

## Repository layout

```text
runner/   FlowFit Runner, AI providers, workflow engine and execution controls
web/      FlowFit operations UI and runtime evidence panel
docs/     Hackathon submission and demo materials
```

## Setup

Requirements:

- Node.js 20+
- npm
- Nebius Token Factory API key
- optional PostgreSQL/Neon database for persistent production-style workflow state

### 1. Runner

```bash
cd runner
npm install --include=dev
copy .env.example .env
```

Set at minimum:

```env
NEBIUS_API_KEY=your_key
NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1
NEBIUS_MODEL=nvidia/nemotron-3-super-120b-a12b
TASK_UNDERSTANDING_PROVIDER=nebius
TASK_UNDERSTANDING_MODEL=nvidia/nemotron-3-super-120b-a12b
RUNNER_API_KEYS=ff_your_64_hex_character_key
PORT=3001
```

Then:

```bash
npm run build
node dist/index.js
```

### 2. Web UI

```bash
cd web
npm install
copy .env.local.example .env.local
```

Configure the Runner URL and use the same Runner API key.

Then:

```bash
npm run build
npm start -- --hostname 0.0.0.0 --port 3007
```

Open:

```text
http://localhost:3007/admin/agent-runs
```

## Verified local test

A real Nebius Token Factory request through the FlowFit UI proxy produced:

```text
task_type: quote_request
engine: llm
provider: nebius
model: nvidia/nemotron-3-super-120b-a12b
runtime status: live
measured latency: 4081 ms
```

Latency is a single observed test result, not a performance guarantee.

## Safety boundary

FlowFit deliberately separates:

```text
Model recommendation
≠
Action authorization
```

Nemotron can structure and reason about incoming work.

Deterministic policy layers decide whether a task is blocked, requires approval, or may proceed.

## Development status

FlowFit is not presented as a finished commercial product.

The current build demonstrates the architecture and a working multi-step prototype. Connectors, recovery coverage, industry-specific procedures, long-running reliability, and production security hardening remain active development areas.

## License

MIT
