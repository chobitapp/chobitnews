# chobitnews

自分専用の GitHub 朝刊。GitHub は [`chobitapp/chobitnews`](https://github.com/chobitapp/chobitnews)。このリポジトリは zaru-note から独立している。

いまは本開発前の検証を置く。固定リポからの OSS 収集と、保存済みカタログからの朝刊生成をローカル SQLite / CLI で実装した。掲載判断と順位は機械、文章はテンプレまたは Cloudflare AI Gateway 経由の Grok。Story と判断を保存し、翌日は同じニュースを掲載しない。結果・残り TODO は [docs/検証結果.md](docs/検証結果.md)。収集は [docs/収集.md](docs/収集.md)、生成は [docs/生成.md](docs/生成.md)、本番化は [docs/本番ワークフロー.md](docs/本番ワークフロー.md)。

## 検証していること

1. 入力はローカルパスではなく GitHub 上のリポジトリ（`package.json`）
2. 調査（Investigation）と判断（Judgment）を SQLite に残す
3. 1日目: 世代割れを新規掲載する
4. 2日目: GitHub 側が変わっていなければ「新ニュースなし。担当は継続、再掲載しない」
5. 3日目: 片方が揃ったら Story を resolve し、解消だけ書く

OAuth アプリはまだ繋がない。GitHub アクセスの確認は、手元の `gh auth`（user token）を user-to-server の代用にする。本開発で Login with GitHub に差し替える。

## 実行

Node 24 と pnpm を使う。初回はこのリポジトリで次を実行すれば、APIキーや既存DBなしで品質確認用の朝刊を読める。

```sh
pnpm install --frozen-lockfile
pnpm verify:generate      # 4項+2件の見送りを表示
```

その他の検証:

```sh
pnpm verify               # 三日分の連続、テンプレ号、固定世界からの OSS 収集
pnpm verify:github        # 自分の GitHub から直接依存を取り、同じ三日をシミュレート
pnpm verify:copy          # 手書き1号と同じ事実をテンプレで号にする
pnpm verify:generate      # 生成品質 fixture から4項+2holdを組版。ネットワーク無し
pnpm verify:ingest        # 固定ユーザ / リポから OSS カタログを sqlite へ
pnpm verify:ingest:live   # リポ集合は固定のまま、npm / GitHub は実応答
```

`verify:github` の3日目は GitHub を書き換えない。世代割れがあったパッケージを、検証用にメモリ上で揃える。

## 保存済みカタログから1号を読む

Node 24 で検証。`--date` は必須。同じ日を再実行すると保存済みの号を返す。過去の日付との比較にはカタログのコピーを使う。生成は全ユーザの号を同時に保存し、`--user`（既定 `zaru`）は表示するユーザを選ぶ。

`data/` のDB・生成紙面はGitに含めない。初回は `pnpm verify:ingest` で固定データのカタログを作る。既存のライブ収集カタログを保存しておきたい場合は、そのDBをコピーするか、空のチェックアウトで収集検証を行う。

```sh
node --import tsx src/cli.ts generate --date 2026-09-21 --catalog data/catalog.sqlite --output data/edition-2026-09-21.md
```

stdout は Markdown 紙面、stderr は集計 JSON。`--output` は任意。`--fixture PATH` と `--catalog PATH` は片方だけ指定する。品質 fixture は収集用 fixture と分け、空のメモリ DB に seed する。

LLM を使う場合は `--llm` を追加し、手元の環境に `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`（対象 Account の **AI Gateway Run**）を設定する。Gateway は `LLM_GATEWAY_ID`（既定 `chobitnews`）、model は `LLM_MODEL`（既定 `grok-4.6`）。Gateway の Grok Provider Keys に alias `default` の xAI キーを保存し、Require provider credentials を On にする。アプリに `XAI_API_KEY` は不要。

```sh
node --import tsx src/cli.ts generate --date 2026-09-21 --fixture fixtures/generate-night.json --llm
```

掲載上限8パッケージを決めてから LLM を呼ぶ。失敗・空本文・kind 不一致・入力にない URL/数字は、その項だけテンプレにする。設定欠落は実行前にエラー。同日保存号を LLM で上書きしない。実 Grok での JSON 本文生成はまだ未検証。

## まだやらないこと

- OAuth アプリの登録とコールバック（認可済み状態は fixture で固定）
- 号の Web UI
- Issue の熱、停滞、近傍、使い方指摘
- zaru-note への書き戻し

検証ログの短い版は残さない。詳細は `docs/検証結果.md` だけを更新する。
