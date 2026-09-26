import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { appendOperationChatAssistantMessage } from "@/services/operationChatFileStore";
import { addAutoProcessingKeyword, readAutoProcessingCriteria } from "@/services/autoProcessingCriteriaStore";
import { decideRunnerApproval, dispatchTaskToDevice, executeRunnerTask, upsertRunnerAutonomyCriterion } from "@/services/runnerClient";
import { updateWholesaleModuleSettings, wholesaleSettingsRouteMeta } from "@/lib/wholesale-settings";
import type { WholesaleSettingsModuleRoute } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApprovalCardRequest = {
  action?: unknown;
  approvalId?: unknown;
  label?: unknown;
  payload?: unknown;
  sessionId?: unknown;
};

function buildStructuredMessage(type: string, payload: Record<string, unknown>) {
  return JSON.stringify({ type, payload }, null, 2);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asTextArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function isSettingsModule(value: string): value is WholesaleSettingsModuleRoute {
  return value in wholesaleSettingsRouteMeta;
}

async function buildSettingsFollowUp(input: { action: string; payload?: unknown }) {
  const payload = asRecord(input.payload);
  const data = asRecord(payload.data);
  const messageType = typeof payload.type === "string" ? payload.type : "";
  const module = typeof data.module === "string" ? data.module : "";
  const patch = asRecord(data.patch);

  if (messageType !== "ai_card_settings_update") {
    return null;
  }

  if (input.action === "hold") {
    return buildStructuredMessage("ai_text", {
      text: "설정 변경을 보류했습니다. 실제 설정 파일에는 반영하지 않았습니다.",
    });
  }

  if (input.action !== "apply_settings_update") {
    return null;
  }

  if (!isSettingsModule(module) || !Object.keys(patch).length) {
    return buildStructuredMessage("ai_text", {
      text: "적용할 설정 모듈이나 변경값을 찾지 못했습니다. 다시 설정값을 말해 주세요.",
    });
  }

  const settings = await updateWholesaleModuleSettings(module, patch);
  revalidatePath("/admin/settings");
  revalidatePath(`/admin/settings/${module}`);

  return buildStructuredMessage("ai_text", {
    text: [
      "설정 변경을 저장했습니다.",
      "",
      `모듈: ${wholesaleSettingsRouteMeta[module].title}`,
      `변경 항목: ${Array.isArray(data.changes) ? data.changes.length : Object.keys(patch).length}개`,
      "",
      "이 기준은 사용자의 로컬 설정 파일에 저장되었습니다. 앱 재시작 후 실행 엔진에도 같은 기준으로 적용됩니다.",
    ].join("\n"),
    settings,
  });
}

async function buildAutoCriteriaFollowUp(input: { action: string; payload?: unknown }) {
  const payload = asRecord(input.payload);
  const data = asRecord(payload.data);
  const refs = asRecord(payload.refs);
  const messageType = typeof payload.type === "string" ? payload.type : "";
  const criterionId = typeof data.criterionId === "string" ? data.criterionId : typeof refs.criterionId === "string" ? refs.criterionId : "";
  const keywords = asTextArray(data.keywords);

  if (messageType !== "ai_card_auto_criteria" && !criterionId) {
    return null;
  }

  if (input.action === "hold") {
    return buildStructuredMessage("ai_text", {
      text: "자동 처리 기준 추가를 보류했습니다. 기준 파일에는 아직 반영하지 않았습니다.",
    });
  }

  if (input.action !== "add_auto_criteria") {
    return null;
  }

  if (!criterionId || !keywords.length) {
    return buildStructuredMessage("ai_text", {
      text: "자동 처리 기준에 추가할 카테고리나 키워드를 찾지 못했습니다. 다시 한 번 키워드와 기준을 알려주세요.",
    });
  }

  let nextCriteria = await readAutoProcessingCriteria();
  for (const keyword of keywords) {
    nextCriteria = await addAutoProcessingKeyword(criterionId, keyword);
  }

  const criterion = nextCriteria.find((item) => item.id === criterionId);
  let runnerLinked = false;
  let runnerLinkError = "";

  if (criterion) {
    try {
      await upsertRunnerAutonomyCriterion({
        criterionId: criterion.id,
        criterionTitle: criterion.title,
        autoAllowed: criterion.autoAllowed,
        keywords: criterion.keywords.map((keyword) => keyword.label),
      });
      runnerLinked = true;
    } catch (error) {
      runnerLinkError = error instanceof Error ? error.message : String(error);
    }
  }

  return buildStructuredMessage("ai_text", {
    text: [
      "자동 처리 기준에 반영했습니다.",
      "",
      `카테고리: ${criterion?.title ?? criterionId}`,
      `추가 키워드: ${keywords.join(", ")}`,
      `Runner AI 엔진 연결: ${runnerLinked ? "완료" : `보류${runnerLinkError ? ` (${runnerLinkError})` : ""}`}`,
      "",
      "이제 이후 채팅이나 자동 처리 판단에서 해당 키워드를 기준 후보로 사용할 수 있습니다.",
    ].join("\n"),
  });
}

function getErrorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function summarizeExecutionResult(result: Record<string, unknown>) {
  const status = typeof result.status === "string" ? result.status : "";
  const executed = Array.isArray(result.results) ? result.results.length : undefined;
  const lines = ["실행을 요청했습니다."];
  if (status) lines.push(`상태: ${status}`);
  if (executed !== undefined) lines.push(`커넥터 호출: ${executed}건`);
  return lines;
}

/** Runner 실제 업무 카드(실행 대기/승인)의 버튼을 Runner API 호출로 연결 */
async function buildRunnerWorkFollowUp(input: { action: string; payload?: unknown }) {
  const payload = asRecord(input.payload);
  const data = asRecord(payload.data);
  const refs = asRecord(payload.refs);
  const messageType = typeof payload.type === "string" ? payload.type : "";
  const taskId =
    typeof data.taskId === "string" && data.taskId
      ? data.taskId
      : typeof refs.taskId === "string"
        ? refs.taskId
        : "";
  const runnerApprovalId = typeof data.approvalId === "string" ? data.approvalId : "";

  // 실행 대기 카드: 실행 버튼
  if (input.action === "execute_task") {
    if (!taskId) return null;
    try {
      const result = (await executeRunnerTask(taskId)) as Record<string, unknown>;
      return buildStructuredMessage("ai_text", {
        text: [
          ...summarizeExecutionResult(result),
          "",
          `작업 ID: ${taskId}`,
          "진행 상황은 업무 타임라인에서 확인할 수 있습니다.",
        ].join("\n"),
      });
    } catch (error) {
      return buildStructuredMessage("ai_text", {
        text: [
          "실행 요청이 실패했습니다.",
          "",
          `오류: ${getErrorText(error)}`,
          "",
          "커넥터 연결 상태를 확인하거나 잠시 후 다시 시도해 주세요.",
        ].join("\n"),
      });
    }
  }

  // Runner 승인 카드: 승인/반려 버튼
  if ((input.action === "approve" || input.action === "reject") && messageType === "ai_card_approval" && runnerApprovalId) {
    try {
      await decideRunnerApproval({ approvalId: runnerApprovalId, decision: input.action });
    } catch (error) {
      return buildStructuredMessage("ai_text", {
        text: `승인 처리에 실패했습니다.\n\n오류: ${getErrorText(error)}`,
      });
    }

    if (input.action === "reject") {
      return buildStructuredMessage("ai_text", {
        text: "반려했습니다. 이 결정은 승인 이력과 학습(rule memory)에 반영됩니다.",
      });
    }

    // 원격 실행 에이전트(기기)가 있으면 승인된 업무를 device 명령 큐로 내보낸다.
    const capability = typeof data.capability === "string" ? data.capability : "";
    const fields = asRecord(data.fields);
    if (capability && Object.keys(fields).length > 0) {
      try {
        const dispatch = await dispatchTaskToDevice({
          capability,
          fields,
          taskId: taskId || undefined,
          approvalId: runnerApprovalId,
        });
        return buildStructuredMessage("ai_text", {
          text: [
            "승인 완료 후 원격 실행 에이전트로 명령을 보냈습니다.",
            "",
            `명령 ID: ${dispatch.commandId}`,
            `조작 스텝: ${dispatch.stepCount}개`,
            "에이전트가 ERP 화면에서 실행하며, 진행 상황은 업무 타임라인에서 확인할 수 있습니다.",
          ].join("\n"),
        });
      } catch (error) {
        const err = error as { message?: string; missingFields?: string[] };
        const reason = err.message ?? String(error);
        // 연결된 기기가 없으면 커넥터 실행으로 폴백
        if (!reason.includes("no_active_device")) {
          return buildStructuredMessage("ai_text", {
            text: [
              "승인은 완료했지만 원격 실행 준비에 문제가 있습니다.",
              "",
              `사유: ${reason}`,
              err.missingFields?.length ? `부족한 정보: ${err.missingFields.join(", ")}` : "",
            ].filter(Boolean).join("\n"),
          });
        }
        // no_active_device → 아래 커넥터 실행 폴백으로 진행
      }
    }

    if (taskId) {
      try {
        const result = (await executeRunnerTask(taskId)) as Record<string, unknown>;
        return buildStructuredMessage("ai_text", {
          text: [
            "승인 완료 후 실행을 요청했습니다.",
            ...summarizeExecutionResult(result).slice(1),
            "",
            `작업 ID: ${taskId}`,
          ].join("\n"),
        });
      } catch (error) {
        return buildStructuredMessage("ai_text", {
          text: [
            "승인은 완료했지만 실행 요청이 실패했습니다.",
            "",
            `오류: ${getErrorText(error)}`,
            "",
            "커넥터 상태 확인 후 실행 대기 목록에서 다시 실행할 수 있습니다.",
          ].join("\n"),
        });
      }
    }

    return buildStructuredMessage("ai_text", {
      text: "승인 완료. 이 결정은 승인 이력과 학습(rule memory)에 반영됩니다.",
    });
  }

  if (input.action === "hold" && messageType === "ai_card_approval" && runnerApprovalId) {
    return buildStructuredMessage("ai_text", {
      text: "보류했습니다. 이 건은 AI 작업 승인함에 대기 상태로 남아 있습니다.",
    });
  }

  return null;
}

async function buildFollowUpMessage(input: { action: string; approvalId: string; label: string; payload?: unknown }) {
  const runnerWorkFollowUp = await buildRunnerWorkFollowUp({ action: input.action, payload: input.payload });
  if (runnerWorkFollowUp) return runnerWorkFollowUp;

  const settingsFollowUp = await buildSettingsFollowUp({ action: input.action, payload: input.payload });
  if (settingsFollowUp) return settingsFollowUp;

  const autoCriteriaFollowUp = await buildAutoCriteriaFollowUp({ action: input.action, payload: input.payload });
  if (autoCriteriaFollowUp) return autoCriteriaFollowUp;

  if (input.approvalId !== "partner-candidate-a") {
    if (input.action === "accept") {
      return buildStructuredMessage("ai_text", {
        text: "공식 정보 전환 완료. 이 항목은 확정 정보로 남겼습니다. 다음으로 발주 처리 여부를 확인할 수 있습니다.",
      });
    }

    if (input.action === "ask_employee" || input.action === "request_employee_check") {
      return buildStructuredMessage("ai_card_employee_request", {
        requestId: `employee-request-${Date.now()}`,
        targetEmployee: { name: "김직원", channel: "MockConnector" },
        title: "A거래처 발주 확인",
        visibleToEmployee: "A거래처 발주가 오늘 접수되었는지 확인해주세요.",
        internalReason: "발주 후보의 부족한 값을 확인해야 합니다.",
        options: ["접수됨", "미접수", "확인 중"],
        status: "pending_approval",
      });
    }

    if (input.action === "approve_send") {
      return buildStructuredMessage("ai_text", {
        text: "발송 완료로 기록했습니다. 다음 대기 항목을 확인하려면 계속 말씀해 주세요.",
      });
    }

    if (input.action === "reject") {
      return buildStructuredMessage("ai_text", {
        text: "반려했습니다. 반려 사유를 한 줄로 남겨주세요.",
      });
    }

    if (input.action === "save_as_automation") {
      return buildStructuredMessage("ai_text", {
        text: "자동화 조건을 확인하겠습니다. 언제, 어떤 조건에서 반복 실행할지 알려주세요.",
      });
    }

    return buildStructuredMessage("ai_text", {
      text: `처리 항목을 확인했습니다: ${input.label || input.action}. 다음 단계가 필요하면 이어서 말씀해 주세요.`,
    });
  }

  if (input.action === "approve" || input.action === "accept") {
    return buildStructuredMessage("ai_text", {
      text: [
        "공식 정보 전환 완료.",
        "",
        "A거래처 추가 주문 후보를 확정 정보로 남겼습니다.",
        "부족한 값은 상품명입니다. 다음 단계는 담당자에게 상품명을 확인한 뒤 발주 처리 여부를 확정하는 것입니다.",
        "",
        "현재 단계에서는 외부 발송이나 실제 발주 등록은 실행하지 않았습니다.",
      ].join("\n"),
    });
  }

  if (input.action === "recheck" || input.action === "ask_employee") {
    return buildStructuredMessage("ai_card_employee_request", {
      requestId: "employee-request-a-partner-candidate",
      targetEmployee: { name: "김직원", channel: "MockConnector" },
      title: "A거래처 발주 확인",
      visibleToEmployee: "A거래처 발주가 오늘 접수되었는지 확인해주세요.",
      internalReason: "발주 후보의 상품명과 납기 가능 여부 확인이 필요합니다.",
      options: ["접수됨", "미접수", "확인 중"],
      status: "pending_approval",
    });
  }

  return buildStructuredMessage("ai_text", {
    text: "A거래처 후보 처리를 보류했습니다. 이 후보는 아직 공식 처리로 넘기지 않았습니다.",
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as ApprovalCardRequest | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const approvalId = typeof body?.approvalId === "string" ? body.approvalId : "";
  const action = typeof body?.action === "string" ? body.action : "";
  const label = typeof body?.label === "string" ? body.label : action;
  const payload = body?.payload;

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  if (!approvalId || !action) {
    return NextResponse.json({ error: "approvalId and action are required" }, { status: 400 });
  }

  const assistantContent = await buildFollowUpMessage({ action, approvalId, label, payload });
  const session = await appendOperationChatAssistantMessage({ sessionId, assistantContent });

  if (!session) {
    return NextResponse.json({ error: "chat session not found" }, { status: 404 });
  }

  return NextResponse.json({ session }, { status: 201 });
}
