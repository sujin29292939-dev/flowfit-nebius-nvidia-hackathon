export type FlowFitArtifact = {
  code: string;
  language: string;
  lineCount: number;
  title: string;
  type: "html" | "code";
};

const codeFencePattern = /```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)```/g;

function countLines(value: string) {
  return value.split(/\r?\n/).length;
}

function isHtml(language: string, code: string) {
  const normalized = language.toLowerCase();
  return normalized === "html" || /<!doctype html|<html[\s>]/i.test(code);
}

export function extractArtifact(content: string): FlowFitArtifact | null {
  let match: RegExpExecArray | null;
  let best: FlowFitArtifact | null = null;

  while ((match = codeFencePattern.exec(content))) {
    const language = match[1] || "text";
    const code = match[2].trim();
    const lineCount = countLines(code);

    if (lineCount < 200) continue;

    const type = isHtml(language, code) ? "html" : "code";
    const artifact: FlowFitArtifact = {
      code,
      language,
      lineCount,
      title: type === "html" ? "HTML" : language.toUpperCase(),
      type,
    };

    if (!best || artifact.lineCount > best.lineCount) {
      best = artifact;
    }
  }

  if (best) return best;

  const lineCount = countLines(content);
  if (lineCount >= 200 && isHtml("html", content)) {
    return {
      code: content,
      language: "html",
      lineCount,
      title: "HTML",
      type: "html",
    };
  }

  return null;
}
