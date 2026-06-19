# freee残業申請アプリ 現状メモ

確認日: 2026-06-10

## 結論

このフォルダのローカル `main` は GitHub 最新 `v1.0.12` に同期済みです。

- ローカル HEAD: `8e61b44` / `v1.0.12`
- GitHub `origin/main`: `8e61b44` / `v1.0.12`
- GitHub 最新 Release: `v1.0.12`
- 今後のアップデートは、この `v1.0.12` ソースを基準に進める
- 以前の `v1.0.8` ローカル差分は stash と patch に退避済み

退避済みデータ:

- stash: `before-sync-to-v1.0.12-20260610-232057`
- patch: `C:\dev\AI\freee残業申請\local-before-v1.0.12-sync-20260610-232057.patch`

次回アップデート前に、必ず [UPDATE_WORKFLOW.md](UPDATE_WORKFLOW.md) の「最初にやること」を実施する。

## GitHub 最新リリース

Release: https://github.com/punipuni4423-droid/overtime-app/releases/tag/v1.0.12

`v1.0.12` の公開内容:

- 残業状況タブの通知判定を、残業合計ではなく時間外労働のみ基準に変更
- 残業合計列を削除
- 時間外労働列で通知対象を赤表示
- 通知する時間外労働を 30-80 時間まで 5 時間刻みで選択可能化
- 自動承認前の超過確認通知も時間外労働基準へ統一
- Portable ZIP も Release asset として追加済み

Release assets:

- `overtime-app_Setup_1.0.12.exe`
- `overtime-app_Setup_1.0.12.exe.blockmap`
- `latest.yml`
- `freee-application-tool-v1.0.12-portable.zip`

## 関連チャット履歴の要点

### 申請構成をレビュー

有給申請の「取得単位」が `—` になっていた件を調査。

- 申請 No.5903 を API で確認
- `values[0].type = "morning"` が取得できることを確認
- 表示は `values[].type` 優先に変更
- 旧データ向けに `holiday_type` / `usage_type` へフォールバック
- 列名は `取得単位` から `取得内容` に変更
- `morning` / `morning_half` / `am_half` は `午前休`
- `afternoon` / `afternoon_half` / `pm_half` は `午後休`
- `full` / `full_day` は `全休`
- `hourly` / `hour` は `時間休`

### 調査 勤務時間修正申請API

勤務時間修正申請の自動承認と残業時間通知を調査・実装。

- 勤務時間修正は freee HR API の `work_times` 系で取得
- 正しい申請経路か確認してから承認する方針
- 想定経路:
  - `① 残業申請 （Over Time）`
  - `① 残業申請 ・打刻修正（Over Time・Time card correction）`
- 定期自動承認用スクリプト `scripts/auto-approve-work-time.mjs` を追加
- 自動承認対象は、経路チェックに通った申請のみ
- 残業時間が通知対象を超えた場合は自動承認せず、アプリに確認通知を出す
- 通知は申請者ごとにまとまり、「この人を許可して承認」でその人の申請だけ承認
- 残業状況タブは先月を初期表示
- 通知時間は 30-80 時間の 5 時間刻み、初期選択は 30 / 65 時間
- 判定対象は最終的に「時間外労働のみ」。法定休日労働は通知判定に混ぜない
- API で Manager 勤怠が取れない場合の Web 取得フォールバックあり
- Web フォールバック時の青い説明バナーは非表示に変更
- 設定画面は 2 カラム化し、初期ウィンドウは `1180x820` に拡大

## 主要ファイル

- `src/main/index.ts`: IPC、freee API、通知、アップデータ、設定 Store
- `src/main/automation.ts`: Playwright/RPA による申請作成・取消・承認
- `scripts/auto-approve-work-time.mjs`: 定期自動承認スクリプト
- `src/renderer/src/App.tsx`: アプリ全体、更新通知、承認保留ポップアップ
- `src/renderer/src/components/Approvals.tsx`: 承認一覧・自分の申請一覧
- `src/renderer/src/components/ManagerOvertime.tsx`: 残業状況タブ
- `src/renderer/src/components/Settings.tsx`: 設定画面
- `src/shared/leaveUnit.ts`: 有給取得内容の API 値
- `electron-builder.yml`: Windows installer / GitHub release 設定

## ローカル作業ツリーの注意

2026-06-10 に `origin/main` へ fast-forward し、`v1.0.12` をローカル基準にした。

現在追加している未コミット変更は、更新作業を楽にするためのドキュメントと生成物 ignore のみ。

- `.gitignore`
- `.prettierignore`
- `README.md`
- `CLAUDE-残業ツール起動指示.md`
- `docs/PROJECT_STATUS.md`
- `docs/UPDATE_WORKFLOW.md`

アプリ本体のコードは GitHub 最新 `v1.0.12` のまま。

## 検証状況

`v1.0.12` へ同期後、依存関係は `npm install` 済み。

次回作業時は、実装前に `npm run typecheck` と `npm run build` を実行する。
