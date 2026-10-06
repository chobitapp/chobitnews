import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openCatalogDb } from "../src/catalog/store.ts";
import { generateNight, validateGeneratedCopy } from "../src/generate.ts";
import { parseGenerateArgs } from "../src/generate-cli.ts";
import {
  type GenerateFixture,
  loadGenerateNight,
  readGenerateFixture,
} from "../src/generate-fixture.ts";
import type {
  LlmConfig,
  PackageLlmInput,
  PackageLlmOutput,
} from "../src/llm.ts";
import { SqlitePaperStore } from "../src/paper-store.ts";

const fixturePath = fileURLToPath(
  new URL("../fixtures/generate-night.json", import.meta.url),
);
const cfg: LlmConfig = {
  accountId: "test",
  apiToken: "test-token",
  gatewayId: "chobitnews",
  model: "grok-4.6",
};
const fixture = () => readGenerateFixture(fixturePath);
function addPackage(f: GenerateFixture, name: string) {
  f.packages.push({ name, ecosystem: "npm", github_repo: "example/demo" });
  f.users[0]?.packages.push(name);
  f.releases.push({
    package_name: name,
    tag_name: "v2.0.0",
    published_at: "2026-09-20T00:00:00Z",
    html_url: `https://github.com/example/demo/releases/tag/${name}-2.0.0`,
    body: "- 新しい機能を公開",
  });
}

describe("カタログから紙面を作る", () => {
  let db: DatabaseSync;
  afterEach(() => {
    db?.close();
    vi.restoreAllMocks();
  });
  async function setup(f: GenerateFixture = fixture()) {
    db = openCatalogDb();
    const store = new SqlitePaperStore(db);
    await loadGenerateNight(store, f);
    return store;
  }
  function count(table: string) {
    return (
      db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }
    ).n;
  }

  it("品質 fixture は4項+2hold。rank順で核キーワード・出典・判断を残す", async () => {
    const store = await setup();
    const { edition, stats } = await generateNight(store, "2026-09-21");
    expect(edition.items).toHaveLength(4);
    expect(edition.holds).toBe(2);
    expect(edition.items[0]?.headline).not.toContain("4.13.8");
    expect(edition.items[1]?.headline).toContain("速さ");
    expect(edition.items.map((i) => i.storyId)).toEqual([
      "security:hono:GHSA-hxh3-vqpv-xpqv",
      "release:vitest:5.0.1",
      "release:wrangler:4.135.0",
      "release:zod:4.6.5",
    ]);
    for (const keyword of [
      "Flagship",
      "vmThreads",
      "0.74",
      ".validate()",
      "hono/jsx",
      "XSS",
      "今日の最新ではない",
      "パッチ",
    ]) {
      expect(edition.body).toContain(keyword);
    }
    expect(stats).toMatchObject({
      print: 4,
      human: 2,
      llmOk: 0,
      copiesWritten: 4,
    });
    expect(count("package_copies")).toBe(4);
    expect(count("stories")).toBe(6);
    expect(count("investigations")).toBe(6);
    expect(count("judgments")).toBe(6);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(store.getCursor("hono")?.lastPrintedVersion).toBe("4.13.8");
    expect(store.getCursor("@biomejs/biome")?.lastPrintedVersion).toBeNull();
  });

  it("同じ日の再実行は保存号。翌日の同じ入力は0項・0hold・0 LLM", async () => {
    const store = await setup();
    const first = await generateNight(store, "2026-09-21");
    const fetchImpl = vi.fn(async () => {
      throw new Error("呼ばれた");
    });
    const again = await generateNight(store, "2026-09-21", {
      llm: cfg,
      fetchImpl,
    });
    expect(again.edition).toEqual(first.edition);
    expect(again.stats.editionReused).toBe(true);
    const next = await generateNight(store, "2026-09-22", {
      llm: cfg,
      fetchImpl,
    });
    expect(next.edition.items).toHaveLength(0);
    expect(next.edition.holds).toBe(0);
    expect(next.edition.body).toContain("新ニュースなし");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(count("package_copies")).toBe(4);
    expect(next.stats.silent).toBe(6);
    await expect(generateNight(store, "2026-09-20")).rejects.toThrow(
      "過去の日付",
    );
  });

  it("同じパッケージの複数GHSAは1項。9パッケージ目はdeferred、翌日に掲載", async () => {
    const f = fixture();
    f.advisories.push({
      package_name: "hono",
      ghsa_id: "GHSA-second",
      published_at: "2026-09-05T00:00:00Z",
      summary: "もうひとつの修正",
      html_url: "https://github.com/advisories/GHSA-second",
    });
    for (let i = 0; i < 5; i++) addPackage(f, `extra-${i}`);
    const store = await setup(f);
    const first = await generateNight(store, "2026-09-21");
    expect(first.edition.items).toHaveLength(8);
    expect(first.edition.body).toContain("GHSA-second");
    expect(first.edition.body).toContain("GHSA-hxh3-vqpv-xpqv");
    expect(
      db
        .prepare(
          "SELECT visibility FROM night_decisions WHERE date='2026-09-21' AND package_name='hono'",
        )
        .all(),
    ).toEqual([{ visibility: "print" }, { visibility: "print" }]);
    expect(store.hasStory("security:hono:GHSA-second")).toBe(true);
    expect(store.getCursor("zod")).toBeUndefined();
    expect(first.stats.deferred).toBe(1);
    expect(count("package_copies")).toBe(8);
    const second = await generateNight(store, "2026-09-22");
    expect(second.edition.items.map((i) => i.storyId)).toEqual([
      "release:zod:4.6.5",
    ]);
    expect(second.edition.holds).toBe(0);
  });

  it("新版の minor で旧 held を resolved にし、翌日に resolve を繰り返さない", async () => {
    const store = await setup();
    await generateNight(store, "2026-09-21");
    await store.upsertRelease({
      packageName: "@biomejs/biome",
      tagName: "@biomejs/biome@2.6.0",
      publishedAt: "2026-09-22T00:00:00Z",
      htmlUrl: "https://github.com/biomejs/biome/releases/tag/2.6.0",
      body: "- 新しいルールを追加",
      fetchedAt: "2026-09-22",
    });
    const next = await generateNight(store, "2026-09-22");
    expect(next.edition.items).toHaveLength(1);
    expect(next.edition.holds).toBe(0);
    expect(
      db
        .prepare(
          "SELECT status FROM stories WHERE id='release:@biomejs/biome:2.5.14'",
        )
        .get(),
    ).toEqual({ status: "resolved" });
    expect(
      db
        .prepare(
          "SELECT decision,visibility FROM night_decisions WHERE date='2026-09-22' AND story_id='release:@biomejs/biome:2.5.14'",
        )
        .get(),
    ).toEqual({ decision: "resolve", visibility: "silent" });
    await generateNight(store, "2026-09-23");
    expect(
      db
        .prepare(
          "SELECT 1 FROM night_decisions WHERE date='2026-09-23' AND decision='resolve'",
        )
        .get(),
    ).toBeUndefined();
  });

  it("掲載対象だけLLMを呼び、失敗と発明はその項だけテンプレに倒す", async () => {
    const store = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, req?: RequestInit) => {
        const body = JSON.parse(String(req?.body));
        const input = JSON.parse(body.messages[1].content);
        if (input.package === "hono") throw new Error("network unavailable");
        const copy = {
          headline: `${input.package}: 公開情報`,
          lead:
            input.package === "zod"
              ? "99999999 倍速い"
              : "リリースの公開を確認した。",
          kind: input.expectedKind,
          sources: [input.releases[0].htmlUrl],
        };
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(copy) } }],
          }),
        );
      },
    );
    const result = await generateNight(store, "2026-09-21", {
      llm: cfg,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(result.stats).toMatchObject({ print: 4, llmOk: 2, llmFallback: 2 });
    expect(result.edition.body).not.toContain("99999999");
    expect(result.edition.body).toContain(".validate()");
    expect(
      db
        .prepare(
          "SELECT body_source AS source,count(*) AS n FROM package_copies GROUP BY body_source ORDER BY body_source",
        )
        .all(),
    ).toEqual([
      { source: "llm", n: 2 },
      { source: "template", n: 2 },
    ]);
  });

  it("全ユーザでcapしてから生成し、コピーを共有し、他ユーザの項は漏らさない", async () => {
    const f = fixture();
    f.users.push({
      id: "alice",
      github_login: "alice",
      github_id: "1",
      packages: ["hono"],
    });
    const store = await setup(f);
    await generateNight(store, "2026-09-21");
    const alice = store.getEdition("2026-09-21", "alice");
    expect(alice?.items).toHaveLength(1);
    expect(alice?.body).not.toContain("Flagship");
    expect(count("package_copies")).toBe(4);
    expect(count("editions")).toBe(2);
  });

  it("号の保存失敗はcopies・Story・cursor・判断ごとrollbackする", async () => {
    const store = await setup();
    db.exec(
      "CREATE TRIGGER fail_paper BEFORE INSERT ON editions BEGIN SELECT RAISE(ABORT,'test failure'); END",
    );
    await expect(generateNight(store, "2026-09-21")).rejects.toThrow(
      "test failure",
    );
    for (const table of [
      "package_copies",
      "package_cursors",
      "night_decisions",
      "stories",
      "investigations",
      "judgments",
      "editions",
    ]) {
      expect(count(table)).toBe(0);
    }
    db.exec("DROP TRIGGER fail_paper");
    expect(
      (await generateNight(store, "2026-09-21")).edition.items,
    ).toHaveLength(4);
  });
});

describe("LLMの発明検査", () => {
  const input: PackageLlmInput = {
    package: "vitest",
    releases: [
      {
        tag: "v5.0.0",
        publishedAt: "2026-09-03T00:00:00Z",
        body: "vmThreads が 0.74s",
        htmlUrl: "https://github.com/vitest-dev/vitest/releases/tag/v5.0.0",
      },
    ],
    advisories: [],
  };
  const copy: PackageLlmOutput = {
    headline: "vitest 5.0: 速さ",
    lead: "9月3日に公開。vmThreads が 0.74s。",
    sources: [input.releases[0]?.htmlUrl ?? ""],
    kind: "major",
  };
  it("導出した9月3日やsemverの一部を発明扱いしない", () => {
    expect(() => validateGeneratedCopy(copy, input, "major")).not.toThrow();
  });
  it("未知URL・未知数字・kind不一致を拒否する", () => {
    expect(() =>
      validateGeneratedCopy(
        { ...copy, sources: ["https://example.com"] },
        input,
        "major",
      ),
    ).toThrow("URL");
    expect(() =>
      validateGeneratedCopy({ ...copy, lead: "999999 倍高速" }, input, "major"),
    ).toThrow("数字");
    expect(() =>
      validateGeneratedCopy({ ...copy, kind: "patch" }, input, "major"),
    ).toThrow("kind");
  });
});

it("生成CLIの必須日付・入力の排他・未知オプションを検査する", () => {
  const args = ["--date", "2026-09-21", "--fixture", fixturePath];
  expect(parseGenerateArgs(args)).toMatchObject({
    date: "2026-09-21",
    fixture: fixturePath,
    llm: false,
    user: "zaru",
  });
  expect(() => parseGenerateArgs([])).toThrow("--date");
  expect(() => parseGenerateArgs(["--date", "2026-09-21"])).toThrow("片方");
  expect(() =>
    parseGenerateArgs(["--date", "2026-02-30", "--fixture", fixturePath]),
  ).toThrow("実在");
  expect(() =>
    parseGenerateArgs([...args, "--catalog", "missing.sqlite"]),
  ).toThrow("片方");
  expect(() =>
    parseGenerateArgs(["--date", "2026-09-21", "--catalog", "missing.sqlite"]),
  ).toThrow("存在");
  expect(() => parseGenerateArgs([...args, "--unknown"])).toThrow();
});
