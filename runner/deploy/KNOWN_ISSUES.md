# Known Issues

E2E 검증 중 발견된 구조적 결함 기록. 코드 수정 전까지는 운영 시 이 문서를 참고한다.

## A. SMS 발신자(from) 정보가 understanding/context 단계에 전달되지 않음

- **위치**: `src/intake/webhookParsers.ts`(`parseSmsPayload`) → `src/understanding/heuristics.ts`(`extractCustomerName`)
- **증상**: `POST /webhook/sms`의 `from` 필드(발신자/발신번호)는 intake 저장에만 쓰이고, understanding 단계는 `rawText`만 파싱한다. 따라서 문자 본문에 거래처명이 직접 언급되지 않으면 — 예: 발신자가 "남도농산"이어도 본문이 "양파 20박스 내일까지 발주 부탁드립니다"뿐이면 — `customerName`이 절대 추출되지 않는다.
- **재현**: `from:"남도농산"`, `text:"양파 20박스 내일까지 발주 부탁드립니다"`로 `/webhook/sms` 호출 → task의 `extracted_fields_json.missingFields`에 `거래처명` 포함, `context_json.customer.kind === "not_found"`.
- **또한**: `extractCustomerName`의 정규식(`heuristics.ts`)은 "거래처:/고객:/업체:/회사:" 라벨이나 "상사/유통/물산/마트/거래처/컴퍼니/회사/식품/몰" 접미사가 있어야만 인식한다. "남도농산"처럼 다른 접미사("농산")를 쓰는 거래처명은 본문에 그대로 있어도 추출되지 않는다.
- **필요 조치(미적용)**: 발신번호/발신자명 기반으로 거래처를 우선 매칭하는 경로 추가, 또는 거래처명 접미사 목록 확장 및 라벨 없는 매칭 전략 보강.

## B. Decision 엔진의 `riskLevel === "uncertain"` 분기가 context 확인보다 먼저 실행됨

- **위치**: `src/decision/engine.ts` `decideTaskAction()` — `riskLevel` 분기(60번째 줄 부근)가 `contextStatus` 분기(73번째 줄 부근)보다 먼저 평가됨
- **증상**: `riskLevel`은 understanding 단계(`src/understanding/heuristics.ts`)에서 `missingFields.length > 0`이면 무조건 `"uncertain"`으로 고정되고, 이 값은 이후 context matching이 성공해도 재계산되지 않는다. 그리고 decision 엔진은 `riskLevel`을 `contextStatus`보다 먼저 검사하므로, context가 완벽히 매칭돼도 그 결과에 도달하기 전에 이미 "위험도 기준 승인 필요"로 조기 판정된다.
- **필요 조치(미적용)**: context matching 성공 시 riskLevel을 재평가하거나, decision 엔진에서 context 확인 결과가 uncertain 판정을 상쇄할 수 있도록 분기 순서/조건을 재설계.

## C. (수정 완료) `AUTO_RUN` 판정은 승인 카드도, autonomyGate/SHADOW 감사 로그도 만들지 않음

- **수정일**: 2026-07-08
- **위치**: `src/autonomyGate/decisionGate.ts`, `src/decision/runner.ts`, `src/connectors/runtime.ts`
- **조치**: runtime의 첫 write-SHADOW 판정을 단일 `evaluateTaskAutonomy()` 함수로 추출하고, `/tasks/:id/decide`와 `/tasks/:id/execute`가 같은 게이트 판정을 호출하도록 배선했다. `decide` 결과에는 `autonomyGate`가 포함되며, 게이트가 `SHADOW`이면 task status도 `shadowed`로 저장된다.
- **감사 기록**: `decide` 시점에 `AutonomyDecided` 감사 이벤트를 기록하도록 추가했다.
- **회귀 테스트**: 승인 이력 0인 low-risk write가 `AUTO`로 판정되지 않는지, 동일 입력에서 decide/execute 게이트 판정이 일치하는지 `src/autonomyGate/decisionGate.test.ts`로 고정했다.

---

_이 문서는 2026-07-08 E2E 검증(company_production, task_90dee1e8-a47c-4063-bc60-3c3f9202a62c 및 task_4cf396e5-b771-45ec-9bc6-e62f800b0344 기반) 중 발견된 내용을 기록한다. C 항목은 수정 완료되었고, A/B는 아직 미적용 상태다._
