# RPA 申請ボタン無効エラー修正 — Claude Code 用プロンプト

## 現象（コピーして Claude Code に渡す用）

```
残業申請ツールの Web 申請（Playwright RPA）で、申請ボタンをクリックすると次のエラーになります。

- エラー: Error invoking remote method 'api-web-submit-overtime': Error: ブラウザ自動操作中にエラーが発生しました: page.click: Timeout 30000ms exceeded.
- ログより: locator は「申請」ボタンに解決しているが、そのボタンが disabled（class に vb-button--disabled が付いている）のため、クリックが「element is not enabled」で 30 秒間リトライしてタイムアウトしている。
- 申請ボタンは DOM 上にはあるが、フォームのクライアント側検証のため無効のまま有効にならない。
```

## 依頼する修正内容（Claude Code に渡す指示）

```
以下を実施してください。

1. 申請ボタンのクリック処理を変更する
   - 単に「申請」テキストのボタンを探して click するのではなく、「有効な」申請ボタンだけを対象にする。
   - 例: :not(.vb-button--disabled) や :not([disabled]) を使い、有効になったボタンが現れるまで最大 20 秒程度待ってからクリックする。

2. フォーム検証が走るまでの待機を入れる
   - 部署（および申請経路）まで入力したあと、申請ボタンを探す前に 1～2 秒程度 wait を入れる。
   - 必要なら、フォーカスを外す（blur）などして、クライアント側の検証が実行されるようにする。

3. タイムアウト時のメッセージを分かりやすくする
   - 有効な申請ボタンが指定時間内に現れない場合は、「申請ボタンが有効になりませんでした。必須項目の入力・選択を確認してください」のようなメッセージでエラーにすること。

対象ファイル: src/main/automation.ts の submitOvertimeViaBrowser 内、申請ボタンを探してクリックしている箇所（submitSelectors / page.click 付近）。
```

## 本リポジトリで行った対応（参考）

- 部署入力後、約 1.5 秒待機 → `document.activeElement.blur()` → さらに 0.8 秒待機を追加。
- 申請ボタンは「有効な」ものだけを対象に変更:
  - `button.vb-button--appearancePrimary:has-text("申請"):not(.vb-button--disabled)` 等で最大 20 秒待機。
- 有効なボタンが現れない場合は、申請ボタンがずっと無効だった旨を説明するエラーを出すように変更。
- 上記は `overtime-app/src/main/automation.ts` に既に反映済み。ビルドし直す場合は `npm run build` を実行すること。
