type MaskResult = {
  text: string;
  maskedCount: number;
};

const piiPatterns: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b(?:\d[ -]*?){13,19}\b/g, replacement: "[MASKED_CARD]" },
  { pattern: /\b\d{6}[- ]?[1-4]\d{6}\b/g, replacement: "[MASKED_RRN]" },
  { pattern: /\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/g, replacement: "010-****-****" },
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "[MASKED_EMAIL]" },
  { pattern: /\b\d{2,6}[-\s]?\d{2,6}[-\s]?\d{2,8}[-\s]?\d{2,8}\b/g, replacement: "[MASKED_ACCOUNT]" },
  { pattern: /("?(?:password|passwd|pwd)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s&,}]+)/gi, replacement: "$1[MASKED_PASSWORD]" },
  { pattern: /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, replacement: "Authorization: Bearer [MASKED]" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[MASKED_AWS_KEY]" },
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replacement: "[MASKED_JWT]" },
];

function maskString(text: string): MaskResult {
  let maskedCount = 0;
  let next = text;

  for (const { pattern, replacement } of piiPatterns) {
    next = next.replace(pattern, () => {
      maskedCount += 1;
      return replacement;
    });
  }

  return { text: next, maskedCount };
}

function htmlToSummary(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000);
}

export function maskGateResult(result: unknown) {
  if (typeof result === "string") {
    const normalized = /<[^>]+>/.test(result) ? htmlToSummary(result) : result.slice(0, 3000);
    return maskString(normalized);
  }

  const serialized = JSON.stringify(result ?? null);
  if (serialized.length > 200_000 && /data:image\/[a-z]+;base64,/i.test(serialized)) {
    return {
      text: JSON.stringify({
        screenshot: "[MASKED_SCREENSHOT_OVER_200KB]",
        hint: "스크린샷이 커서 AI에는 이미지 원문 대신 안전한 힌트만 전달합니다.",
      }),
      maskedCount: 1,
    };
  }

  const normalized = serialized.length > 20_000 ? serialized.slice(0, 20_000) : serialized;
  return maskString(normalized);
}
