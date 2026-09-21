# chobitnews

自分専用の GitHub 朝刊。このリポジトリは zaru-note から独立している。

いまは本開発前の検証だけを置く。検証したいのは UI でも OAuth 画面でもなく、**同じ Story が日をまたいで続きとして書けるか** である。結果は [docs/検証結果.md](docs/検証結果.md)。再開するときはそこを正本にする。Cloudflare 本番の流れは [docs/本番ワークフロー.md](docs/本番ワークフロー.md)。

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
pnpm verify          # 三日分の連続テストと、同じ事実からのテンプレ号
pnpm verify:github   # 自分の GitHub から直接依存を取り、同じ三日をシミュレート
pnpm verify:copy     # 手書き1号と同じ事実をテンプレで号にする
```

`verify:github` の3日目は GitHub を書き換えない。世代割れがあったパッケージを、検証用にメモリ上で揃える。

## まだやらないこと

- OAuth アプリの登録とコールバック
- 号の Web UI
- Issue の熱、停滞、近傍、使い方指摘
- zaru-note への書き戻し

検証ログの短い版は残さない。詳細は `docs/検証結果.md` だけを更新する。
