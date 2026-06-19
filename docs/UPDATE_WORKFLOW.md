# 更新・リリース手順

この手順は、freee残業申請アプリを安全に更新して GitHub Release へ公開するためのもの。

## 最初にやること

このローカル作業ツリーは、2026-06-10 に GitHub 最新 `v1.0.12` へ同期済み。

次回以降も、作業前に現在の差分を保存してから最新 `origin/main` に合わせる。

```powershell
Set-Location "C:\dev\AI\freee残業申請\overtime-app"
git status -sb
git diff > ..\local-before-update.patch
git fetch --all --tags --prune
```

未コミット変更を一時退避する場合:

```powershell
git stash push -u -m "local changes before syncing to latest release"
git pull --ff-only
```

退避せずに作業を続ける場合は、`origin/main` と差分を比較して、必要な変更だけ移す。

```powershell
git diff --stat origin/main
git diff --name-status origin/main
```

## 開発開始前チェック

```powershell
Set-Location "C:\dev\AI\freee残業申請\overtime-app"
git status -sb
git log --oneline --decorate -5
npm install
npm run typecheck
npm run build
```

`scripts/auto-approve-work-time.mjs` が存在する場合は構文も確認する。

```powershell
node --check out\main\index.js
node --check out\preload\index.js
node --check scripts\auto-approve-work-time.mjs
```

## 実装時の確認ポイント

- freee API のトークン値はログやドキュメントに出さない
- 実承認が走る操作は、ユーザー確認なしに本番データで試さない
- 勤務時間修正の自動承認は、申請経路チェックを必ず通す
- 残業時間通知は「時間外労働のみ」を基準にする
- 通知時間の初期選択は 30 / 65 時間
- 有給申請の取得内容は `values[].type` 優先
- `store-get` / `store-set` は許可リスト方式。新しい設定キーを追加するときは許可リストも更新する
- Web 取得フォールバックは残すが、UI上の説明バナーは出さない方針

## リリース手順

パッチ更新の場合:

```powershell
npm version patch --no-git-tag-version
npm run typecheck
npm run build
npm run build:win
```

差分確認:

```powershell
git status -sb
git diff --stat
```

コミットとタグ:

```powershell
git add package.json package-lock.json src scripts electron-builder.yml
git commit -m "vX.Y.Z: 変更内容"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

GitHub Release 公開:

```powershell
npm run publish:win
gh release view vX.Y.Z --repo punipuni4423-droid/overtime-app
```

`electron-builder` の publish で Draft のままになる場合は、Release を公開状態にする。

```powershell
gh release edit vX.Y.Z --repo punipuni4423-droid/overtime-app --draft=false
```

## Portable ZIP が必要な場合

`dist/win-unpacked` ができていることを確認する。

```powershell
npm run build:unpack
```

ZIP 名は ASCII にする。

```powershell
Compress-Archive -Path dist\win-unpacked -DestinationPath ..\freee-application-tool-vX.Y.Z-portable.zip -Force
```

Release に追加する。

```powershell
gh release upload vX.Y.Z ..\freee-application-tool-vX.Y.Z-portable.zip --repo punipuni4423-droid/overtime-app
```

## 最終確認

```powershell
gh release view vX.Y.Z --repo punipuni4423-droid/overtime-app --json tagName,isDraft,isPrerelease,assets,url
git status -sb
```

確認するもの:

- `latest.yml`
- `overtime-app_Setup_X.Y.Z.exe`
- `.blockmap`
- 必要なら portable ZIP
- Release が Draft ではないこと
- `main` と tag が push 済みであること
