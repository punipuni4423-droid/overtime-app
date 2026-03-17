# 残業ツールを Claude Code で起動するときの指示

Claude Code（または Cursor のターミナル）でこのプロジェクトを開いたときに、残業申請ツールを起動する手順です。

---

## 起動コマンド

このリポジトリのルート（`overtime-app`）で、次のいずれかを実行してください。

### 開発モードで起動（推奨）

```bash
cd "c:\Users\IoT-136\OneDrive - X1Studio Co., Ltd\あんち\02\overtime-app"
npm run dev
```

または、すでに `overtime-app` がカレントディレクトリの場合は:

```bash
npm run dev
```

- Electron + Vite の開発サーバーが立ち上がり、残業申請ツールのウィンドウが開きます。
- ソースを変更するとホットリロードされます。

### ビルド済みのプレビューで起動

```bash
cd "c:\Users\IoT-136\OneDrive - X1Studio Co., Ltd\あんち\02\overtime-app"
npm run build
npm run start
```

- 本番ビルド後にアプリを起動します。

### Windows 用 exe をビルドしてから起動

```bash
cd "c:\Users\IoT-136\OneDrive - X1Studio Co., Ltd\あんち\02\overtime-app"
npm run build:win
```

- ビルド後、`dist` フォルダ内の exe を直接実行できます。

---

## Claude Code に渡す指示文（コピー用）

プロジェクトを開いたあと、Claude Code に次のように指示すると残業ツールを起動できます。

```
残業申請ツール（overtime-app）を起動してください。overtime-app フォルダで npm run dev を実行して、開発モードでアプリを立ち上げてください。
```

または英語で:

```
Please start the overtime application. Run `npm run dev` in the overtime-app folder to launch the app in development mode.
```

---

## 前提条件

- Node.js がインストールされていること
- 初回または `node_modules` がない場合は、先に `npm install` を実行すること

```bash
cd "c:\Users\IoT-136\OneDrive - X1Studio Co., Ltd\あんち\02\overtime-app"
npm install
npm run dev
```
