import { COPY_SYSTEM_PROMPT, type CopyFact, copyUserPrompt } from "./copy.ts";
import type { CopyKind } from "./rank.ts";

export type LlmConfig = {
  accountId: string;
  apiToken: string;
  gatewayId: string;
  model: string;
};
export type PackageLlmInput = {
  package: string;
  releases: {
    tag: string;
    publishedAt: string | null;
    htmlUrl: string | null;
    body: string | null;
  }[];
  advisories: {
    ghsa: string;
    publishedAt: string | null;
    summary: string | null;
    htmlUrl: string | null;
  }[];
};
export type PackageLlmOutput = {
  headline: string;
  lead: string;
  sources: string[];
  kind: CopyKind;
};

export function readLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken)
    throw new Error(
      "--llm には CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN が必要",
    );
  const model = env.LLM_MODEL?.trim() || "grok-4.6";
  if (!model.startsWith("grok-") || model.includes("/"))
    throw new Error(
      "Grok Gateway の LLM_MODEL は grok-4.6 などの provider model 名を指定する",
    );
  return {
    accountId,
    apiToken,
    gatewayId: env.LLM_GATEWAY_ID?.trim() || "chobitnews",
    model,
  };
}

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly schemaError: boolean,
  ) {
    super(`AI Gateway HTTP ${status}`);
  }
}

/** token と provider 本文をエラーへ含めない。BYOK と fallback 禁止を固定する。 */
async function chat(
  cfg: LlmConfig,
  messages: { role: string; content: string }[],
  schema: boolean,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetchImpl(
    `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(cfg.accountId)}/${encodeURIComponent(cfg.gatewayId)}/grok/v1/chat/completions`,
    {
      method: "POST",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
      headers: {
        "cf-aig-authorization": `Bearer ${cfg.apiToken}`,
        "cf-aig-byok-alias": "default",
        "cf-aig-no-wholesale": "true",
        "cf-aig-request-timeout": "60000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        max_tokens: 800,
        stream: false,
        messages,
        ...(schema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "package_copy",
                  strict: true,
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["headline", "lead", "sources", "kind"],
                    properties: {
                      headline: { type: "string" },
                      lead: { type: "string" },
                      sources: { type: "array", items: { type: "string" } },
                      kind: {
                        type: "string",
                        enum: ["security", "major", "minor", "patch", "other"],
                      },
                    },
                  },
                },
              },
            }
          : {}),
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    const schemaError =
      res.status >= 400 &&
      res.status < 500 &&
      ![401, 403, 429].includes(res.status) &&
      /schema|response_format/i.test(body);
    throw new GatewayError(res.status, schemaError);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim())
    throw new Error("AI Gateway が空の本文を返した");
  return content.trim();
}

const GENERATE_SYSTEM_PROMPT = `あなたは個人向け GitHub 朝刊の記者。入力 JSON の事実だけを使って、日本語で1パッケージの項を書く。
headline は対象・版・変更点。lead は2〜5文。sources は入力 htmlUrl の部分集合。kind は入力の expectedKind と一致させる。
事実にない数字、機能、日付、URL を足さない。手元の使用バージョンや世代割れには触れない。
出力は headline, lead, sources, kind の JSON object のみ。`;

export async function completePackageCopy(
  cfg: LlmConfig,
  input: PackageLlmInput,
  expectedKind: CopyKind,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<PackageLlmOutput> {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
    : AbortSignal.timeout(60_000);
  const messages = [
    { role: "system", content: GENERATE_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify({ ...input, expectedKind }) },
  ];
  let content: string;
  try {
    content = await chat(cfg, messages, true, fetchImpl, requestSignal);
  } catch (err) {
    if (!(err instanceof GatewayError) || !err.schemaError) throw err;
    content = await chat(cfg, messages, false, fetchImpl, requestSignal);
  }
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  const output: unknown = JSON.parse(content.slice(start, end + 1));
  if (!output || typeof output !== "object")
    throw new Error("LLM JSON の形式が不正");
  const copy = output as PackageLlmOutput;
  if (
    typeof copy.headline !== "string" ||
    !copy.headline.trim() ||
    typeof copy.lead !== "string" ||
    !copy.lead.trim() ||
    !Array.isArray(copy.sources) ||
    !copy.sources.every((s) => typeof s === "string") ||
    !["security", "major", "minor", "patch", "other"].includes(copy.kind) ||
    Object.keys(copy).some(
      (k) => !["headline", "lead", "sources", "kind"].includes(k),
    )
  ) {
    throw new Error("LLM JSON の必須項目が不正");
  }
  return copy;
}

/** SAMPLE_FACTS のデバッグ経路も同じ Gateway を使う。 */
export async function generateItemWithLlm(
  date: string,
  fact: CopyFact,
  cfg: LlmConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  return chat(
    cfg,
    [
      { role: "system", content: COPY_SYSTEM_PROMPT },
      { role: "user", content: copyUserPrompt(date, fact) },
    ],
    false,
    fetchImpl,
  );
}
