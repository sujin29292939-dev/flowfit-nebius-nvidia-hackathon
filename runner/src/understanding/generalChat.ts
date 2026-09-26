import { getGeneralChatModel } from "../llm/modelConfig.js";
import { callGeminiGenerateContent, extractGeminiText, textToGeminiContents } from "../llm/gemini.js";
import { getFlowFitAiProvider } from "../llm/modelConfig.js";

export type GeneralChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

function normalizeHistory(history: GeneralChatHistoryMessage[] | undefined) {
  return (history ?? [])
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 3000),
    }))
    .filter((message) => message.content)
    .slice(-12);
}

export async function groqGeneralChat(input: { message: string; system?: string; history?: GeneralChatHistoryMessage[] }) {
  if (getFlowFitAiProvider() === "gemini") {
    return geminiGeneralChat(input);
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is required");
  }

  const history = normalizeHistory(input.history);

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getGeneralChatModel(),
      temperature: 0.4,
      max_completion_tokens: 800,
      messages: [
        {
          role: "system",
          content: input.system?.trim() || [
            "You are FlowFit's AI chat assistant.",
            "Answer naturally in the user's language.",
            "If the user is greeting or asking a general question, reply conversationally.",
            "Do not pretend a business intake was created unless the user clearly asks for order or quote handling.",
          ].join(" "),
        },
        ...history,
        { role: "user", content: input.message.slice(0, 6000) },
      ],
    }),
  });

  const body = await response.json().catch(() => null) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Groq chat failed: ${response.status}`);
  }

  const content = body?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Groq chat returned an empty response");
  }

  return { reply: content, engine: "llm", provider: "groq" };
}

async function geminiGeneralChat(input: { message: string; system?: string; history?: GeneralChatHistoryMessage[] }) {
  const history = normalizeHistory(input.history);
  const body = await callGeminiGenerateContent({
    model: getGeneralChatModel(),
    temperature: 0.4,
    maxOutputTokens: 800,
    responseMimeType: input.system?.trim() ? "application/json" : "text/plain",
    system: input.system?.trim() || [
      "You are FlowFit's AI chat assistant.",
      "Answer naturally in the user's language.",
      "If the user is greeting or asking a general question, reply conversationally.",
      "Do not pretend a business intake was created unless the user clearly asks for order or quote handling.",
    ].join(" "),
    contents: textToGeminiContents([
      ...history,
      { role: "user", content: input.message.slice(0, 6000) },
    ]),
  });

  const content = extractGeminiText(body);
  if (!content) {
    throw new Error("Gemini chat returned an empty response");
  }
  return { reply: content, engine: "llm", provider: "gemini" };
}
