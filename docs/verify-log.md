# 検証ログ 2026-09-21

## 連続テスト（fixture）

`pnpm verify` は通った。

- 1日目: `drift:wrangler` を新規掲載、status は developing
- 2日目: 同じ inventory でも号の item は 0、judgment は hold。Story は開いたまま
- 3日目: バージョンを揃えると resolve。investigation は3夜分残る

## GitHub からの実データ

`pnpm verify:github` は `gh auth` の user token で GraphQL した。viewer は `zaru`。

直近 push 40 リポジトリのルート `package.json` から、追跡対象 97 行。世代割れは 8 本（biome / workers-types / hono / react / typescript / vitest / wrangler / zod）。

同じパイプラインで:

- 1日目: 8 本を掲載
- 2日目: 新ニュースなし、holds=8
- 3日目: biome をメモリ上で揃えた結果、biome だけ解消。他 7 本は書かない

## わかったこと

- ローカルパスなしで GitHub から直接依存は取れる
- 手帳（investigation / judgment / story）がないと 2 日目がまた 8 本の「新ニュース」になる
- `ownerAffiliations: COLLABORATOR` だと会社・別 org まで入り、世代割れが広すぎる。本開発では Beat の allowlist が先
- cinema-ticketing や Durable Objects デモは、直近 40 件のルート package.json には出ていない。GitHub に無い、または別パス、または push が古い
