# 対象日入力欄エラー改善のためのプロンプト

以下の内容を AI または開発者に渡して、`api-web-submit-overtime` 実行時の「対象日入力欄が見つかりませんでした」エラーを解消してください。

---

## 依頼文（このブロックをそのままコピーして使ってください）

```
freee 残業申請 RPA で、リモートメソッド 'api-web-submit-overtime' 実行時に次のエラーが出ます。

「ブラウザ自動操作中にエラーが発生しました: 対象日入力欄が見つかりませんでした。」

【対象日入力欄の仕様（実画面の HTML）】
- セレクタ: input#approval-request-fields-date
- 属性: type="text", role="combobox", autocomplete="off"
- クラス: vb-textField vb-textField--widthMedium vb-textField--withIcon vb-textField--responsive
- aria-controls: vb-dateInput_15__listbox（数値部分は変動する可能性あり）
- aria-haspopup="listbox"
- 日付の形式: YYYY-MM-DD（例: 2026年3月13日 → "2026-03-13"）

【依頼内容】
1. 対象日入力欄を確実に取得・入力できるように automation.ts の該当処理を修正してください。
2. この入力欄は combobox（リストボックス連動）のため、通常の fill だけでなく「クリックしてから入力」や「リストボックス表示待ち」が必要な可能性があります。既存の handleCombobox の考え方を日付欄にも適用するか、日付専用の待機・入力ロジックを追加してください。
3. 対象日は呼び出し元で YYYY-MM-DD（例: 2026-03-13）で渡されている前提で、その形式のまま入力するようにしてください。
4. フォームが SPA で遅れて描画される可能性があるため、対象日フィールドの待機時間（formWaitTimeout）が足りていない場合は延長も検討してください。
5. 修正後は、対象日入力欄が見つからなかった場合のエラーメッセージ「対象日入力欄が見つかりませんでした。」が不要になるよう、該当セレクタで要素を確実に特定・操作できる状態にしてください。
```

---

## 参照情報（開発用）

- **対象コード**: `overtime-app/src/main/automation.ts`
  - 対象日のセレクタ: `date: ['input#approval-request-fields-date', 'input[name="approval_request[target_date]"]']`
  - フォーム入力: `fillField(selectors.date, normalizedDate, formWaitTimeout)`（約 268〜302 行付近）
  - 既存の combobox 処理: `handleCombobox()`（約 58〜94 行）で、クリック → fill → aria-controls の listbox 内 option をクリックする流れ
- **日付の正規化**: 既に `normalizedDate` で YYYY-MM-DD に統一している（263〜266 行付近）
- **メモ**: RPA-improvement-notes.md に、p.secure.freee.co.jp の Vibe UI に `input#approval-request-fields-date` がある旨の記載あり

このプロンプトで、対象日入力欄の特定と入力が安定して行えるように修正してください。
