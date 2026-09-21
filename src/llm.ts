import { COPY_SYSTEM_PROMPT, type CopyFact, copyUserPrompt } from "./copy.ts";

const API_URL = "https://api.x.ai/v1/responses";
const MODEL = "grok-4.6";

type ResponsesApi = {
  output_text?: string;
  output?: { content?: { type: string; text?: string }[] }[];
};

function outputText(json: ResponsesApi): string {
  if (json.output_text?.trim()) {
    return json.output_text.trim();
  }
  const chunks: string[] = [];
  for (const item of json.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && part.text) {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join("").trim();
}

export function readXaiApiKey(): string | undefined {
  const key = process.env.XAI_API_KEY?.trim();
  return key ? key : undefined;
}

export async function generateItemWithLlm(
  date: string,
  fact: CopyFact,
  apiKey: string,
): Promise<string> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      input: [
        { role: "system", content: COPY_SYSTEM_PROMPT },
        { role: "user", content: copyUserPrompt(date, fact) },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`xAI ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as ResponsesApi;
  const text = outputText(json);
  if (!text) {
    throw new Error("xAI が空の本文を返した");
  }
  return text;
}
