# FlowFit Connector 자동 발견·실행 모듈

이 채팅에서 만든 7개 파일. 전부 `zod`만 런타임 의존이고, `--strict`로 함께 타입체크 통과 상태.
연결 발견 → 검증·고정 → 선택 → 게이트 → 실행 → 자가치유까지 한 줄로 이어진다.

## 파일 역할

| 파일 | 역할 |
|---|---|
| `connectorTypes.ts` | 단일 출처 타입: Capability / ConnectionKind / HealthState / **MappingProfile** |
| `connectorResolver.ts` | 능력 계층(INTENT_CAPABILITY) + 중앙 Resolver + HealthProbe/runHealthCheck |
| `connectorDiscovery.ts` | 자기수정 발견 루프(생성→검증→재생성→고정) + rediscoverOnBreak |
| `connectorDiscoveryLive.ts` | 발견 포트 실제 구현: docFinder/synthesizer(Anthropic API) + validator(실 HTTP) |
| `connectorExecutor.ts` | 고정된 프로파일로 실제 HTTP 호출 (buildHttpCall 공유) |
| `workExecutionPipeline.ts` | resolve→actionGuard→autonomyGate→execute 실행 경로 |
| `autopilotTicker.ts` | ticker + kind별 일반 probe + 깨짐→재발견 자동 트리거 |

## 흐름

```
[발견]  docFinder → synthesizer → validator(통과해야만) → 고정 → 카탈로그
[실행]  intent → resolve → actionGuard → autonomyGate → execute
[치유]  ticker → HealthProbe → down 전이 → rediscoverOnBreak → 재고정 → health 초기화
```

## 아직 비어 있는 것 (실제 코드베이스에 꽂을 자리)

전부 "포트(interface)"로 주입되게 설계됨. 아래 어댑터만 끼우면 동작:

- **게이트 3종** (`workExecutionPipeline.ts`): `ActionGuardPort` ← actionGuard.ts / `AutonomyGatePort` ← autonomyGate / `ApprovalsPort` ← approvals
- **저장소** (`connectorResolver.ts`의 `ResolverDeps`, `autopilotTicker.ts`의 `listDueConnections`/`persist`/`resetHealth`) ← Neon repo
- **자격증명** (`resolveCredential`) ← runtime.resolveEnvCredential
- **API 키** ← AnthropicSynthesizer/DocFinder 생성자 또는 `process.env.ANTHROPIC_API_KEY`

## 알려진 한계

- 재발견은 커넥터의 주 능력 1개(`provides[0]`)로만 동작. 다능력 커넥터는 능력별 프로파일로 확장 필요.
- `claude-sonnet-4-6` 기본 모델명은 실제 키로 1회 확인 권장.
- 서버리스 배포 시 ticker는 외부 크론이 `/tick`에서 `runTick()` 호출(상시 루프 불가).
