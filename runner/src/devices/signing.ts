// devices/signing.ts
// 명령 서명·해시·토큰 해시 유틸리티.
// - 명령은 본문 해시 + HMAC 서명으로 무결성/진위를 보장한다.
// - 토큰은 원문을 저장하지 않고 해시만 저장한다(탈취 시 원문 노출 방지).
// - nonce/TTL은 재전송 공격을 막는다.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 명령 서명용 서버 비밀키. 운영에서는 반드시 환경변수로 주입한다. */
function commandSecret(): string {
  return process.env.DEVICE_COMMAND_SECRET ?? "flowfit-dev-command-secret";
}

/** 토큰 해시용 서버 비밀키(pepper). */
function tokenPepper(): string {
  return process.env.DEVICE_TOKEN_PEPPER ?? "flowfit-dev-token-pepper";
}

/** 랜덤 토큰 원문 생성 (에이전트에 1회만 전달, 서버는 해시만 보관) */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** 페어링 코드 생성 (사람이 입력 가능한 짧은 형태) */
export function generatePairingCode(): string {
  return `FF-${randomBytes(4).toString("hex").toUpperCase()}`;
}

/** nonce 생성 */
export function generateNonce(): string {
  return randomBytes(16).toString("base64url");
}

/** 토큰 해시 (pepper 포함 SHA-256) */
export function hashToken(token: string): string {
  return createHash("sha256").update(`${tokenPepper()}:${token}`).digest("hex");
}

/** 명령 본문 해시 (steps 등 실행 내용의 무결성 기준) */
export function hashCommandBody(body: unknown): string {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

/**
 * 명령 서명 생성.
 * 서명 대상: commandId, deviceId, companyId, capability, idempotencyKey, nonce, bodyHash, expiresAt
 * 이 필드 중 하나라도 변조되면 서명 검증이 실패한다.
 */
export function signCommand(input: {
  commandId: string;
  deviceId: string;
  companyId: string;
  capability: string;
  idempotencyKey: string;
  nonce: string;
  bodyHash: string;
  expiresAt: string;
}): string {
  const canonical = [
    input.commandId,
    input.deviceId,
    input.companyId,
    input.capability,
    input.idempotencyKey,
    input.nonce,
    input.bodyHash,
    input.expiresAt,
  ].join("|");
  return createHmac("sha256", commandSecret()).update(canonical).digest("hex");
}

/** 명령 서명 검증 (에이전트 측 검증과 동일 로직 — 참조 구현) */
export function verifyCommandSignature(input: {
  commandId: string;
  deviceId: string;
  companyId: string;
  capability: string;
  idempotencyKey: string;
  nonce: string;
  bodyHash: string;
  expiresAt: string;
  signature: string;
}): boolean {
  const expected = signCommand(input);
  return safeEqualHex(expected, input.signature);
}

/** 상수시간 문자열 비교 (토큰/서명 비교용) */
export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** 키 순서에 무관한 안정적 직렬화 (해시 재현성 보장) */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
