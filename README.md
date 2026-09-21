# chobitnews

自分専用の GitHub 朝刊。GitHub は [`chobitapp/chobitnews`](https://github.com/chobitapp/chobitnews)。このリポジトリは zaru-note から独立している。

いまは本開発前の検証だけを置く。Story の日をまたぐ連続は検証済み。次の段は、OAuth 済みユーザと対象リポを静的データで固定し、そこから OSS を機械収集して共有カタログに残すことである。結果は [docs/検証結果.md](docs/検証結果.md)。収集の設計は [docs/収集.md](docs/収集.md)。再開するときは検証結果を正本にする。Cloudflare 本番の流れは [docs/本番ワークフロー.md](docs/本番ワークフロー.md)。

## 検証していること

1. 入力はローカルパスではなく GitHub 上のリポジトリ（`package.json`）
2. 調査（Investigation）と判断（Judgment）を SQLite に残す
3. 1日目: 世代割れを新規掲載する
4. 2日目: GitHub 側が変わっていなければ「新ニュースなし。担当は継続、再掲載しない」
5. 3日目: 片方が揃ったら Story を resolve し、解消だけ書く

OAuth アプリはまだ繋がない。GitHub アクセスの確認は、手元の `gh auth`（user token）を user-to-server の代用にする。本開発で Login with GitHub に差し替える。

## 実行

```sh
pnpm install
pnpm verify               # 三日分の連続、テンプレ号、固定世界からの OSS 収集
pnpm verify:github        # 自分の GitHub から直接依存を取り、同じ三日をシミュレート
pnpm verify:copy          # 手書き1号と同じ事実をテンプレで号にする
pnpm verify:ingest        # 固定ユーザ / リポから OSS カタログを sqlite へ
pnpm verify:ingest:live   # リポ集合は固定のまま、npm / GitHub は実応答
```

`verify:github` の3日目は GitHub を書き換えない。世代割れがあったパッケージを、検証用にメモリ上で揃える。

## まだやらないこと

- OAuth アプリの登録とコールバック（認可済み状態は fixture で固定）
- 号の Web UI
- Issue の熱、停滞、近傍、使い方指摘
- zaru-note への書き戻し

検証ログの短い版は残さない。詳細は `docs/検証結果.md` だけを更新する。
