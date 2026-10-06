import { describe, expect, it, vi } from "vitest";
import {
  completePackageCopy,
  GatewayError,
  type LlmConfig,
  type PackageLlmInput,
  readLlmConfig,
} from "../src/llm.ts";

const cfg: LlmConfig = {
  accountId: "account",
  apiToken: "test-token",
  gatewayId: "chobitnews",
  model: "grok-4.6",
};
const input: PackageLlmInput = {
  package: "hono",
  releases: [],
  advisories: [],
};
const output = {
  headline: "hono: 修正",
  lead: "公開情報を確認する。",
  sources: [],
  kind: "security",
};
const ok = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(output) } }],
    }),
  );

describe("検証済み Grok Gateway クライアント", () => {
  it("保存 BYOK のみを指定し Chat Completions から JSON を読む", async () => {
    const fetchImpl = vi.fn(async () => ok());
    expect(
      await completePackageCopy(cfg, input, "security", fetchImpl),
    ).toEqual(output);
    const [url, req] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://gateway.ai.cloudflare.com/v1/account/chobitnews/grok/v1/chat/completions",
    );
    const headers = new Headers(req.headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("cf-aig-authorization")).toBe("Bearer test-token");
    expect(headers.get("cf-aig-byok-alias")).toBe("default");
    expect(headers.get("cf-aig-no-wholesale")).toBe("true");
    const body = JSON.parse(String(req.body));
    expect(body).toMatchObject({
      model: "grok-4.6",
      stream: false,
      max_tokens: 800,
      response_format: { type: "json_schema" },
    });
    expect(body.messages).toHaveLength(2);
    expect(body.input).toBeUndefined();
    expect(req.signal).toBeInstanceOf(AbortSignal);
  });

  it("schema 関連の 400 だけ一度 schema を外す", async () => {
    const fetchImpl = vi
      .fn(async () => ok())
      .mockResolvedValueOnce(
        new Response("unsupported response_format json_schema", {
          status: 400,
        }),
      );
    await completePackageCopy(cfg, input, "security", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [, req] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(req.body)).response_format).toBeUndefined();
  });

  it.each([401, 403, 429, 500, 400])(
    "HTTP %s の認証/一般エラーは retry せず本文を漏らさない",
    async (status) => {
      const fetchImpl = vi.fn(
        async () => new Response("credential=test-secret", { status }),
      );
      await expect(
        completePackageCopy(cfg, input, "security", fetchImpl),
      ).rejects.toThrow(`AI Gateway HTTP ${status}`);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
  it.each([401, 403, 429, 500])(
    "schema と書かれても HTTP %s は retry しない",
    async (status) => {
      const fetchImpl = vi.fn(
        async () => new Response("schema failure", { status }),
      );
      await expect(
        completePackageCopy(cfg, input, "security", fetchImpl),
      ).rejects.toBeInstanceOf(GatewayError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("reasoning のみなら空本文として失敗する", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { reasoning_content: "thought", content: "" } },
            ],
          }),
        ),
    );
    await expect(
      completePackageCopy(cfg, input, "security", fetchImpl),
    ).rejects.toThrow("空の本文");
  });
  it("必須項目の型と未知キーを検査する", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ ...output, sources: "oops" }),
                },
              },
            ],
          }),
        ),
    );
    await expect(
      completePackageCopy(cfg, input, "security", fetchImpl),
    ).rejects.toThrow("必須項目");
  });
  it("missing credentials やカタログ model を黙って使わない", () => {
    expect(() => readLlmConfig({})).toThrow("CLOUDFLARE_ACCOUNT_ID");
    expect(
      readLlmConfig({
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_API_TOKEN: "test",
      }).model,
    ).toBe("grok-4.6");
    expect(() =>
      readLlmConfig({
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_API_TOKEN: "test",
        LLM_MODEL: "xai/grok-4.6",
      }),
    ).toThrow("provider model");
  });
});
