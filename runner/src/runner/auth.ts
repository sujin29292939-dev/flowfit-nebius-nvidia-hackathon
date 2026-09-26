// runner/auth.ts
// Bearer 토큰 검증
//
// 토큰 구조: "ff_" 접두사 + 32바이트 랜덤 hex = 총 67자
// 예: ff_a3f9c2e1b8d4...
//
// 다중 토큰 지원: RUNNER_API_KEYS="key1,key2,key3"
// → Studio 인스턴스별 키 발급, 개별 폐기 가능
//
// 타이밍 공격 방지: timingSafeEqual 비교

import { timingSafeEqual, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

// ─────────────────────────────────────────────
// 토큰 생성 유틸 (키 발급 시 사용)
// tsx src/runner/auth.ts 로 직접 실행하면 새 키 출력
// ─────────────────────────────────────────────
export function generateApiKey(): string {
  return "ff_" + randomBytes(32).toString("hex");
}

// ─────────────────────────────────────────────
// 환경변수에서 허용 키 목록 로드
// ─────────────────────────────────────────────
function loadAllowedKeys(): Set<string> {
  const raw = process.env.RUNNER_API_KEYS ?? "";
  const keys = raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.startsWith("ff_") && k.length === 67);

  if (keys.length === 0) {
    console.warn("[auth] WARNING: RUNNER_API_KEYS is empty. Protected requests will be rejected.");
  }

  return new Set(keys);
}

// 서버 시작 시 1회 로드 (재시작 없이 키 변경 불가 → 의도적 설계)
const ALLOWED_KEYS = loadAllowedKeys();

// ─────────────────────────────────────────────
// 토큰 비교: 타이밍 공격 방지
// ─────────────────────────────────────────────
function safeCompare(a: string, b: string): boolean {
  // 길이가 다르면 즉시 false지만, 길이 정보 자체는 노출됨
  // 실제 비교는 항상 동일 길이로 패딩해서 수행
  const target = Buffer.from(a.padEnd(67, "\0"), "utf-8");
  const input  = Buffer.from(b.padEnd(67, "\0"), "utf-8");
  // Buffer 길이가 다르면 timingSafeEqual이 throw → 명시적 처리
  if (target.length !== input.length) return false;
  return timingSafeEqual(target, input);
}

// ─────────────────────────────────────────────
// 토큰 검증
// ─────────────────────────────────────────────
function extractToken(req: IncomingMessage): string | null {
  const header = req.headers["authorization"] ?? "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7).trim();
}

export function verifyToken(req: IncomingMessage): boolean {
  const token = extractToken(req);
  if (!token) return false;

  for (const allowed of ALLOWED_KEYS) {
    if (safeCompare(allowed, token)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────
// 미들웨어: server.ts 라우터에서 호출
// 인증 실패 시 401 반환 후 true를 돌려줌 (= "이미 처리됨, 라우터 중단")
// ─────────────────────────────────────────────
export function requireAuth(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string
): boolean {
  if (verifyToken(req)) return false; // 인증 성공 → 라우터 계속

  res.writeHead(401, {
    "Content-Type":                "application/json",
    "WWW-Authenticate":            'Bearer realm="FlowFit Runner"',
    "Access-Control-Allow-Origin": origin,
  });
  res.end(JSON.stringify({ error: "Unauthorized" }));
  return true; // 인증 실패 → 라우터 중단
}

// ─────────────────────────────────────────────
// 키 발급 CLI: tsx src/runner/auth.ts
// ─────────────────────────────────────────────
const isMain =
  process.argv[1]?.endsWith("auth.ts") ||
  process.argv[1]?.endsWith("auth.js");

if (isMain) {
  const newKey = generateApiKey();
  console.log("\n새 API 키가 생성됐습니다:\n");
  console.log(`  ${newKey}\n`);
  console.log(".env에 추가하는 방법:");
  console.log(`  RUNNER_API_KEYS="${newKey}"\n`);
  console.log("여러 키 (Studio 인스턴스별):");
  console.log(`  RUNNER_API_KEYS="${newKey},ff_다른키..."\n`);
}
