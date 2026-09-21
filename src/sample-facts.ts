import type { CopyFact } from "./copy.ts";

/** 2026-09-21 手書き1号と同じ調査。版のピンは含まない。 */
export const SAMPLE_EDITION_DATE = "2026-09-21";

export const SAMPLE_FACTS: CopyFact[] = [
  {
    storyId: "release:wrangler:4.135.0",
    subject: "wrangler",
    decision: "print_new",
    occurredOn: "2026-09-18",
    versionLabel: "4.135",
    thesis: "Flagship をローカルで評価する",
    points: [
      "開発時の Flagship バインディングが、既定で Miniflare のローカルストアを見る",
      "本番フラグから切り離したままオフラインで動く",
      "リモートを使うときはバインディングに remote: true",
      "wrangler flagship flags pull でリモートから種をまける",
      "同じリリースで、実験的 Build Output を出すときに Dockerfile の Container イメージもビルドする",
    ],
    sources: [
      "https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.135.0",
    ],
  },
  {
    storyId: "release:vitest:5.0.0",
    subject: "Vitest",
    decision: "print_new",
    occurredOn: "2026-09-03",
    versionLabel: "5.0",
    thesis: "計測の主眼は速さ",
    points: [
      "9月3日に 5.0、9月15日に 5.0.1",
      "公式ブログの比較では Vitest 4.1.10 比で、依存の重いスイートが vmThreads で 1.59s から 0.74s",
      "Browser Mode と大きい isolated スイートが伸びる",
      "環境起動が支配する forks + jsdom はほぼ横ばい",
      "Vite >= 6.4 と Node >= 22.12 が要る",
      "5.0.1 は UI のトレース表示と、list 失敗時の exit 1 など",
    ],
    sources: [
      "https://vitest.dev/blog/vitest-5.html",
      "https://github.com/vitest-dev/vitest/releases/tag/v5.0.1",
    ],
  },
  {
    storyId: "release:zod:4.6.0",
    subject: "Zod",
    decision: "print_new",
    occurredOn: "2026-09-09",
    versionLabel: "4.6",
    thesis: "`.validate()` は結果を作らない",
    points: [
      "9月9日に 4.6.0、9月13日に 4.6.5",
      "`.validate()` は通るかだけを返す。無効入力で ZodError を組まない",
      "z.compile() と合わせると、無効パスで .safeParse().success より最大 35 倍速いと公式が書いている",
      "z.instanceof().properties() はクラスインスタンスのプロパティをその場で見る",
      "z.iban() と、再帰スキーマのメモリ保持の修正",
      "4.6.4 で z.url() が URL.canParse() になり、無効 URL の拒否が約 50 倍速い",
    ],
    sources: [
      "https://github.com/colinhacks/zod/releases/tag/v4.6.0",
      "https://zod.dev/blog/zod-4-6",
    ],
  },
  {
    storyId: "security:hono:4.13.7",
    subject: "Hono",
    decision: "print_new",
    occurredOn: "2026-09-04",
    versionLabel: "4.13.7",
    thesis: "`hono/jsx` の XSS",
    points: [
      "Suspense / ErrorBoundary / Context.Provider と、hono/jsx/dom/server の renderToString / renderToReadableStream が、子や fallback の素の文字列をエスケープせず出していた",
      "GHSA-hxh3-vqpv-xpqv",
      "信頼できない文字列をそこに渡しているなら上げる話",
      "9月15日の 4.13.8 は JSX DOM の keyed update の高速化と Accept ヘッダの q=0 スキップなど。セキュリティではない",
    ],
    sources: [
      "https://github.com/honojs/hono/releases/tag/v4.13.7",
      "https://github.com/honojs/hono/releases/tag/v4.13.8",
    ],
  },
  {
    storyId: "hold:typescript:7.0",
    subject: "TypeScript 7.0",
    decision: "hold",
    occurredOn: "2026-07-08",
    versionLabel: "7.0",
    thesis: "Go 移植の正式リリース",
    points: [],
    sources: [],
    holdReason: "7月の正式リリース。大きいが、今日の最新ではない",
  },
  {
    storyId: "hold:biome:2.5.14",
    subject: "Biome 2.5.14",
    decision: "hold",
    occurredOn: "2026-09-16",
    versionLabel: "2.5.14",
    thesis: "パッチ",
    points: [],
    sources: [],
    holdReason: "バグ修正約 50 と nursery ルール 14。パッチの羅列なので hold",
  },
];
