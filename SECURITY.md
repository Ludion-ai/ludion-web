# 弱い所の知らせ方 / Security

ludion.ai やこのリポジトリのコードに弱い所を見つけたときは、**Issue や pull request に書かずに**、次のどちらかで知らせてください。

If you find a vulnerability in ludion.ai or in this repository, please **do not open a public issue or pull request**. Report it privately in one of these ways:

1. **GitHub の Private vulnerability reporting**（おすすめ）：このリポジトリの [Security → Report a vulnerability](https://github.com/Ludion-ai/ludion-web/security/advisories/new)。運営とあなただけが読めます。
   GitHub private vulnerability reporting (preferred): [Security → Report a vulnerability](https://github.com/Ludion-ai/ludion-web/security/advisories/new). Only you and the maintainers can read it.
2. **メール** / Email：**ludion-support@googlegroups.com**

## 書いてほしいこと / What to include

- 何が起きるか（例：作品の JS が ludion.ai のログインの cookie に届く）
- 再現の手順（URL、使ったブラウザ、作品のコード）
- 分かれば、影響の範囲

## 対象 / Scope

- ludion.ai と、その下の URL
- このリポジトリのコード（`apps/`、`packages/`）
- 作品の枠の守り（作品の JS が、枠の外へ出る、ludion.ai のオリジンで動く、外へ通信する、など）

次は対象の外です。

- 大量の要求で止める試し（DoS）、ほかの人のアカウントやデータに触る試し
- 他人の作品を壊したり、勝手に取り下げたりすること

試すときは、自分のアカウントと自分の作品だけを使ってください。

## 受け取ったあと / After you report

受け取ったら、できるだけ早く確かめて返事をします。直すまでは、内容を公開しないでください。
