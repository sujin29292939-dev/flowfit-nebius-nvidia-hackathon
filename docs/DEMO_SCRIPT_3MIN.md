# FlowFit Demo Script — target 2:30

## 0:00–0:15 — Problem

**Screen:** FlowFit admin workspace.

**Narration:**

"AI can understand a business request, but understanding is not the same as safely completing the work. FlowFit separates AI reasoning from authorization, execution, and recovery."

Keep the runtime panel visible.

Show:

```text
Prototype · Active development
READY · no live call yet
Provider: Nebius
Model: nvidia/nemotron-3-super-120b-a12b
```

## 0:15–0:35 — Real input

Paste one operational request:

```text
A거래처에서 산업용 필터 30개 견적을 금요일 오전까지 요청했습니다.
담당자 확인 후 이메일 회신이 필요합니다.
```

Click **수집 후 AI 분류**.

Do not cut away while the request is processing.

## 0:35–0:55 — Prove Nebius/Nemotron is actually running

After the request succeeds, refresh if necessary.

Show the runtime panel changing to:

```text
LIVE
Provider: Nebius
Model: nvidia/nemotron-3-super-120b-a12b
Latency: <actual measured value> ms
Last success: <actual time>
```

**Narration:**

"This is a real runtime call to NVIDIA Nemotron 3 Super through Nebius Token Factory. LIVE only appears after a successful inference; it is not a static badge."

Then point to the generated task type, confidence, and risk.

## 0:55–1:20 — Explain the boundary

**Screen:** AI classification result.

**Narration:**

"Nemotron structures the messy request into a task. But the model does not get final authority. FlowFit passes the result into separate company context, decision, autonomy, and approval layers."

Click **판단**.

Show the resulting decision card.

## 1:20–1:50 — Multi-step workflow

**Screen:** decision status and timeline.

**Narration:**

"The Decision Engine applies explicit operational rules. AutonomyGate determines whether the task can proceed automatically, needs human approval, or must be blocked. ExecutionAuthority controls the actual action."

Open **이력**.

Briefly show the task timeline.

Do not imply every connector is production complete.

## 1:50–2:10 — Failure and recovery concept

**Screen:** exceptions/recovery area or existing recovery/timeline UI.

**Narration:**

"FlowFit also treats failure as part of the workflow. External execution is not assumed to succeed. Failed or uncertain operations remain visible and can be routed into recovery instead of being blindly repeated."

Only show a failure path that currently exists in the prototype.

## 2:10–2:30 — Hackathon update and close

Return to the runtime panel.

**Narration:**

"FlowFit existed before this hackathon. During the submission period I added Nebius Token Factory as a first-class model provider, integrated NVIDIA Nemotron into task understanding and the shared agent layer, and added real runtime evidence for provider, model, latency, and successful calls."

Final screen:

```text
FlowFit
Verified Execution Infrastructure for AI Agents
Prototype · Active development
Nebius Token Factory + NVIDIA Nemotron
```
