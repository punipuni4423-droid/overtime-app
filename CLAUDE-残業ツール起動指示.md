# 残業申請ツール 起動指示

このプロジェクトを Codex / Claude Code / Cursor などで開いたときに、残業申請ツールを起動するためのメモです。

## 開発モードで起動

```powershell
Set-Location "C:\dev\AI\freee残業申請\overtime-app"
npm install
npm run dev
```

Electron + Vite の開発サーバーが起動し、アプリのウィンドウが開きます。

## ビルド済みプレビューで起動

```powershell
Set-Location "C:\dev\AI\freee残業申請\overtime-app"
npm run build
npm run start
```

## Windows 用インストーラーを作成

```powershell
Set-Location "C:\dev\AI\freee残業申請\overtime-app"
npm run build:win
```

生成物は `dist` フォルダに出力されます。

## Codex への依頼例

```text
残業申請ツールを起動してください。overtime-app フォルダで npm run dev を実行して、開発モードでアプリを立ち上げてください。
```

## 注意

2026-06-10 時点で、このローカル作業ツリーは GitHub 最新 `v1.0.12` に同期済みです。

アップデート作業をする前に、必ず `docs/PROJECT_STATUS.md` と `docs/UPDATE_WORKFLOW.md` を確認してください。
