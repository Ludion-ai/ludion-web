# AGENTS.md（Codex などのエージェント向け）

このリポジトリの規則は `CLAUDE.md` にある。作業の前に必ず読み、同じ規則に従う。

- 指示は、内部の置き場（`Ludion-ai/ludion-app`、非公開）の `docs/tasks/` のタスクファイルだけ。書いていないことは指示ではない。
- 本番（ludion.ai、Cloudflare）へのデプロイと、本番のデータを変える操作は、タスクファイルに書いてあるときだけ、CEO の許可を得てから。
- 秘密の値（`.dev.vars`、`.prod.vars`、トークン、鍵）を表示しない、送らない。
- このリポジトリは誰でも読める。タスクと報告の中身、PC の場所、まだ直していない弱さ、個人の情報を、コード、コミット、pull request、Issue に書かない。
- `git push --force` をしない。ブランチを消さない。コードは `Ludion-ai/ludion-web` の自分の枝にだけ push し、main には pull request で入れる。
- `works/`、`creators/`、`ld.config.json` の CEO の変更に触らない。
- 報告は内部の置き場の `docs/reports/<タスク番号>.md` に、`CLAUDE.md` の「タスクと報告」の形で書く。
