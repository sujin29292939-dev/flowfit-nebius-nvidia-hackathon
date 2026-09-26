# Devpost Submission Draft

## Project name

FlowFit — Verified Execution Infrastructure for AI Agents

## Track

Best Apps and Agents

## One-line summary

FlowFit turns messy business requests into evidence-grounded, reviewable workflows while keeping authorization, approval, execution, verification, and recovery outside the LLM.

## Inspiration

Business AI often stops at generating an answer.

Real operations require more: the system must identify supporting evidence, decide what can be automated, request approval for sensitive actions, verify external effects, and recover safely from failure.

FlowFit was created around that gap between AI reasoning and dependable execution.

## What it does

A business request enters FlowFit as an intake.

NVIDIA Nemotron on Nebius Token Factory structures the request into a normalized task. FlowFit then matches company context, applies deterministic decision rules, passes the task through AutonomyGate, requests human approval where required, and only then reaches the execution layer.

Execution results are verified rather than assumed.

Failures can be routed into recovery and remain visible in the workflow timeline and audit trail.

The current prototype demonstrates:

1. Intake collection.
2. Nemotron-powered task understanding.
3. Context and decision stages.
4. Deterministic autonomy and approval controls.
5. Execution authority boundaries.
6. Recovery and audit structures.
7. Live runtime evidence showing the actual provider, model, latency, and last successful Nebius call.

## How we used Nebius and NVIDIA

FlowFit uses the Nebius Token Factory inference API at runtime.

The current model is:

```text
nvidia/nemotron-3-super-120b-a12b
```

Nemotron powers the task-understanding stage that converts unstructured operational messages into structured business tasks.

We also added Nebius as a first-class provider in FlowFit's shared agent model layer so the same runtime can support agent reasoning and tool-calling paths.

The LLM does not receive final authorization authority.

## Architecture

```text
Business input
  ↓
Nebius Token Factory
  ↓
NVIDIA Nemotron 3 Super
  ↓
Task Understanding
  ↓
Context Matching
  ↓
Decision Engine
  ↓
AutonomyGate
  ↓
Human Approval when required
  ↓
ExecutionAuthority
  ↓
Connector / Device execution
  ↓
Recovery + Timeline + Audit
```

## Significant update during the submission period

FlowFit existed before this hackathon.

The original FlowFit Runner repository was created in July 2026.

After the submission period began on August 26, 2026, FlowFit was significantly updated with a new Nebius/NVIDIA runtime layer rather than merely changing branding.

The submission-period work includes the Nebius provider, Nemotron task understanding, provider-compatible tool calling, real runtime telemetry, LIVE evidence UI, and integration of that runtime with FlowFit's existing controlled execution pipeline.

## Why this is different

FlowFit does not treat better prompting as the solution to every operational failure.

The design intentionally uses different mechanisms for different jobs:

- LLM: interpret ambiguous human input.
- Context layer: connect the task to company data.
- Decision Engine: apply explicit operational rules.
- AutonomyGate: determine whether automation is allowed.
- Approval layer: keep human authority where required.
- ExecutionAuthority: restrict actual actions.
- Verifier and Recovery: handle external failure.

This makes the model part of the system rather than the entire system.

## Current status

FlowFit is a working prototype under active development, not a finished commercial product.

The current submission demonstrates a real Nebius/Nemotron runtime call inside a multi-step operational workflow.

A verified local run returned a quotation task through the UI-to-Runner path and changed the runtime panel from READY to LIVE.

## What we learned

The most important lesson was that reliability does not come from asking one model to be more careful.

Reliable business agents need explicit boundaries around reasoning, authority, external execution, and failure recovery.

Nebius Token Factory made it straightforward to add a high-capability open NVIDIA model to the existing provider architecture without moving those safety and operational boundaries into the model itself.

## What's next

Next work focuses on deeper real-world connectors, reusable verified procedures, recovery coverage, industry-specific modules, and longer-running operational testing.
