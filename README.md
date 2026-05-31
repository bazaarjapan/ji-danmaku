# 🎏 Ji-Danmaku

WindowsのPC画面とマイク入力を監視し、デスクトップ全面の透明オーバーレイに
**ニコニコ動画風の弾幕（視聴者コメント）** をリアルタイムで流すアプリです。
大勢の視聴者にライブ配信していて、画面に弾幕がドッと流れてくるような体験ができます。

弾幕の「視聴者」は AI ブレイン（既定は **Codex app-server**）が、いま映っている画面と
配信者の発話に反応してコメントを生成します。喋ると、その内容に視聴者が反応して弾幕が増えます。

> 💡 **既定は追加料金なし**: ブレインの既定 Codex は `codex login`（ChatGPT / Codex サブスク）認証を
> そのまま使う app-server 方式で、API キーによる従量課金は発生しません。常駐1本＋ephemeralスレッドで
> 入力トークンを最小に保ちます。音声認識もローカル(Whisper)なら無料・オフラインです。

---

## ✨ できること

- **画面全面オーバーレイ**：透明・最前面・クリック透過。弾幕は流れるだけで操作を邪魔しません。
- **画面を見て反応**：定期的にスクショ＋前面ウィンドウ名を取り、AI がニコ動風コメントを生成。
- **声に反応**：マイク発話を文字起こしし、その「内容」に視聴者が反応して弾幕が流れます。
  - 音声認識は **ローカルWhisper（既定・無料・オフライン）**。必要時だけ **GPT Realtime Whisper（高精度・従量課金）** に手動切替。
  - **認識テキストを画面に表示**（🗣 直近の聞き取り履歴）。GPT Realtime Whisper時は**従量課金の概算金額**も表示。
- **声 ↔ 画面 の反応バランス**：スライダー(0–100)で「声だけ／画面だけ／ブレンド」を調整。
- **均等ペーシング**：生成バッチを一気に出さず、次バッチまで一定テンポで流します。
- **重複防止＋反復抑制**：同じコメントの連発を防ぎ、話題が進む多様なコメントに。
- **ニコ動風表現**：色 / 大(big) / 小(small) / 上下固定(ue/shita)。発話・感情に応じた自動カラーも。
- **フィラー弾幕**：AIが途切れた隙間に賑やかし（www/草/888・絵文字・顔文字）。ON/OFF可。
- **NGワードフィルタ**：不適切語を除外/伏字化（AI・フィラー両方に適用）。
- **マルチモニター対応**：全ディスプレイにオーバーレイ。キャプチャ対象も選択可。
- **3種のブレイン**：`codex`（推奨）/ `anthropic`（Claude Vision）/ `mock`（AI不要）。失敗時は自動フォールバック。
- **コントロール画面**：「字弾幕スタート」を中心にしたシンプルUI。トップに現在の稼働状況、マイク、文字起こし、Whisper準備状態、直近の文字起こしを表示し、詳細設定はハンバーガーメニューに集約。

## 🧰 必要なもの

- Windows 10/11
- Node.js 18+（確認環境: v24）
- 推奨: [Codex CLI](https://github.com/openai/codex) インストール＆ `codex login` 済み
  - 未ログイン/未インストールでも動きます（mock弾幕にフォールバック）
- 任意: GPT Realtime Whisper を手動で使う場合は、コントロール画面で OpenAI APIキーを保存

## 🚀 セットアップ & 起動

```powershell
npm install
npm start
```

起動すると **コントロール画面** と **透明オーバーレイ** が開きます。

1. コントロール画面の「▶ 字弾幕スタート」（または **F8**）を押す
2. 普段どおりPCを使う → 画面の上を弾幕が流れ始めます
3. 「マイク監視」＋「発話を文字起こし」をONにして喋ると、内容に反応した弾幕が増えます

## ⌨ 操作

| 操作 | 内容 |
|------|------|
| **F8** | 配信 ON / OFF（グローバル） |
| **F7** | コントロール画面を最前面に呼び出す（裏に隠れた時の救済） |
| テスト弾幕 | 任意の文字を即座に流して見た目を確認 |

## ⚙ 設定

設定はコントロール画面右上のハンバーガーメニューから即時に変更でき、
`%APPDATA%\ji-danmaku\config.json` に保存されます。設定内は
**音声・マイク / AIブレイン / 弾幕の出し方 / 弾幕の見た目 / テスト** に整理され、
関係ない項目（例: GPT Realtime Whisper選択時のWhisperモデル）は自動的に隠れます。

| 項目 | 説明 |
|------|------|
| ブレイン | `codex` / `anthropic` / `mock` |
| 生成間隔 | 画面を見て生成する周期（Codexは1回 ~20秒） |
| 反応バランス | `voiceReactivity`(0–100)。100=声のみ / 0=画面のみ / 中間=ブレンド |
| フィラー弾幕を追加 | OFFで **AIが生成した弾幕だけ** を流す（www/草等の自動フィラーを止める） |
| フィラー密度 | フィラーON時の自動弾幕の量（/分） |
| 流れる速さ / 文字サイズ / 不透明度 | 弾幕の見た目 |
| マイク監視 | 喋ると弾幕が反応（音量検知・常時オフライン） |
| 音声認識エンジン | `local`(既定: ローカルWhisper・無料) / `openai`(手動切替: GPT Realtime Whisper・従量) |
| Whisperモデル | ローカル時: `tiny` / `base` / `small`(推奨) / `medium` |
| マルチモニター | `multiMonitor`。全ディスプレイに弾幕 / プライマリのみ |
| NGワード | `ngWords` / `ngMode`(`drop`除外 / `mask`伏字) |

### 🎙 音声認識（既定ローカル / GPT Realtime Whisper 手動切替）

既定は **ローカルWhisper** です。「発話を文字起こし」をONにすると、追加課金なし・オフラインで文字起こしします。
必要な場合だけ「音声認識エンジン」で **GPT Realtime Whisper** に手動切替できます。聞き取った内容は
コントロール画面に **🗣 認識テキスト（直近履歴）** として表示されます。

- **ローカルWhisper**（既定・無料）: Transformers.js + onnxruntime-web で **このPCのCPU/GPU** で実行。
  音声は外部に出ません。初回のみモデルをDL（`small`で数百MB）、以降はキャッシュからオフライン動作。
  WebGPUが使えれば自動でGPU実行（高速）。日本語は `small` 以上を推奨。
- **GPT Realtime Whisper**（OpenAI `gpt-realtime-whisper` / Realtime API）: 高精度。**発話の区切りごとに送信**するので
  「声に反応する間だけ課金」（$0.017/分）。コントロール画面で **OpenAI APIキー** を保存すると使えます。
  開発時は環境変数 `OPENAI_API_KEY` / `.env.local` も利用できます。音声はクラウドに送信されます。
  - コントロール画面に **☁ OpenAI概算コスト（累計）** を表示。単価は `openaiSttUsdPerMin`（既定0.017）、
    累計音声長は `openaiUsageMs` に保存。あくまで概算（正確な請求は OpenAI ダッシュボード）。
- 発話の終わりらしい「間」(`sttSilenceMs`)まで待って一文をまとめて解析するので、文中の小さな間で
  途切れて文脈を取り違えにくくなっています。

```ini
# .env.local（開発用のみ。gitignore 済み・配布物にも含めません）
OPENAI_API_KEY=sk-...
```

### 🧠 ブレインの切り替え

- **Codex**（既定 / app-server）: `codex login` 済みならそのまま。`codex app-server` を常駐させ
  effort=low で高速・低コスト。**追加のAPI課金なし**。モデルは `codex.model` で指定可。
- **Claude**: 環境変数 `ANTHROPIC_API_KEY` を設定すると Vision で画面に反応します。
- **mock**: AI不要。文脈ワード＋定番リアクション＋絵文字で賑わいを作ります。

## 📦 配布用ビルド（Windows .exe）

[electron-builder](https://www.electron.build/) でインストーラ / ポータブル exe を生成できます。

```powershell
npm run dist
```

- 生成物は `dist/` に出力（`.gitignore` 済み）。NSISインストーラとポータブル exe の両方。
- Whisper はレンダラーから `node_modules` を直接読むため `asar` は無効化。未使用の重いネイティブ依存
  （`onnxruntime-node` / `sharp`）はビルドから除外してサイズを抑えています。
- `.env` / `.env.local` / `dist/` は配布物に含めない設定です。OpenAI APIキーは利用者がコントロール画面で保存します。
- アイコン未同梱（Electron既定）。`build.win.icon` に `.ico` を指定すると差し替え可能。

## 🗂 構成

```
electron/
  main.js            メインプロセス（ウィンドウ/キャプチャループ/IPC/.env.local読込）
  preload.js         レンダラへの安全なAPIブリッジ
  config.js          設定の読み書き（%APPDATA%）
  screen.js          前面ウィンドウ名＋スクリーンショット取得
  ai/
    index.js         ブレインのディスパッチャ（失敗時 mock フォールバック）
    codex.js         Codex app-server 連携（常駐JSON-RPC / 画像入力 / レート制御・バックオフ）
    anthropic.js     Claude Vision 連携（任意）
    mock.js          フィラー弾幕生成（語彙・絵文字・文脈ワード）
    openai-stt.js    OpenAI Realtime(GA) 音声認識クライアント（ws）
renderer/
  overlay.*          透明オーバーレイ＋弾幕エンジン（レーン管理/big/small/固定/色）
  control.*          コントロール画面（getUserMedia/VU/PCM収集/VAD/条件表示UI/認識履歴・コスト表示）
  whisper-worker.js  ローカルWhisper(Transformers.js)を回すWeb Worker
.github/workflows/ci.yml  PRごとに node --check ＋ 簡易lint
```

## 🔩 仕組みのポイント

- **弾幕エンジン**：各コメントをレーンに割り当て、右→左へ `transform` でGPU合成スクロール。
  big は2レーン確保、上下固定(ue/shita)は中央寄せで数秒静止。
- **均等ペーシング**：生成間隔を実測し「残り時間 ÷ 残り個数」で配分。一気流れを防止。
- **声主役の生成**：発話があれば「その発言への反応」を主役に、無ければ画面に控えめ。
  声100%時はスクショも画面文脈も渡さず発言だけに反応。
- **安定性**：app-serverのレート制御＋失敗時バックオフ。`backgroundThrottling:false` で
  最小化/裏でもマイク監視・弾幕が止まりません。

## 🔒 注意 / プライバシー

- 画面キャプチャ・マイクを使用します。配信や録画と併用する際はプライバシーにご注意ください。
- 既定（Codex＋ローカルWhisper）は**音声・画面を外部送信しません**。
- **GPT Realtime Whisperを選んだ場合のみ**、発話音声がOpenAIに送信され従量課金が発生します。
- コントロール画面で保存したOpenAI APIキーは、Electron `safeStorage` で暗号化して
  `%APPDATA%\ji-danmaku\config.json` に保存します。開発用の `.env.local` はコミットせず、配布物にも含めません。

## 📄 ライセンス

Ji-Danmaku本体のソースコードは **MIT License** で公開しています。詳細は
[`LICENSE`](./LICENSE) を参照してください。

依存ライブラリ、Electron/Chromium、ローカルWhisperモデル、OpenAI APIなどには、
それぞれのライセンスまたは利用規約が適用されます。詳細は
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) を参照してください。

GPT Realtime Whisperを利用する場合、利用者自身のOpenAI APIキーとOpenAIの利用条件・料金が適用されます。
