# Ji-Danmaku

Ji-Danmaku は、Windows デスクトップ上にニコニコ動画風の弾幕を流す Electron アプリです。

画面キャプチャとマイク入力をもとに、AI が「配信を見ている視聴者」のような短いコメントを生成し、透明な常時最前面オーバーレイに流します。コントロール画面と Windows 通知領域アイコンから、開始、停止、緊急停止、設定変更ができます。

## 重要: Codex CLI / Codex app-server が前提です

このアプリの標準の AI ブレインは **Codex app-server** です。通常の利用では、PC に **Codex CLI がインストールされていて、`codex app-server` が使える状態** であることを前提にしています。

具体的には、次の状態が必要です。

- `codex` または Windows の `codex.cmd` が PATH から起動できる
- `codex login` 済みで、Codex CLI が利用可能なアカウントに接続されている
- `codex app-server --help` が成功する
- アプリから `codex app-server` を stdio で起動できる

Ji-Danmaku は起動時に手動で `codex app-server` を立ち上げる必要はありません。アプリ側が必要に応じて `codex app-server` を起動し、1 本の常駐 app-server を再利用します。ただし、Codex CLI 自体が未インストール、未ログイン、PATH 未設定、または app-server を使えない状態だと、Codex による画面・音声反応生成は動きません。

Codex が使えない場合でもアプリ自体は起動し、`mock` 弾幕へフォールバックできます。ただし、これはデモ・退避用です。Ji-Danmaku 本来の「画面と発話を見て AI が反応する」体験には、Codex CLI と Codex app-server が必要です。

## できること

- デスクトップ全面に透明な弾幕オーバーレイを表示
- 前面ウィンドウとスクリーンショットをもとに弾幕を生成
- マイク入力を文字起こしし、発話内容に反応した弾幕を生成
- 声と画面の反応バランスを調整
- 声 100% モードでは画面を使わず、発話だけに反応
- 画面変化がないときは AI 生成を抑制して負荷を下げる
- Codex の生成が詰まった場合は watchdog と fallback で停止しにくくする
- NG ワード除外、伏字化、フィラー弾幕、表示速度、文字サイズを調整
- マルチモニターに対応
- Zoom / OBS の画面共有に弾幕を映すモードに対応
- Windows 通知領域アイコンからコントロール画面表示、開始、停止、終了

## 必要環境

- Windows 10 / 11
- Node.js 18 以上
- npm
- Codex CLI
- Codex CLI で `codex login` 済み
- Codex CLI で `codex app-server` が使える状態

## Codex CLI の確認

アプリを起動する前に、PowerShell で次を確認してください。

```powershell
codex --version
codex app-server --help
```

未ログインの場合は、Codex CLI 側でログインしてください。

```powershell
codex login
```

`codex app-server --help` が失敗する場合、Ji-Danmaku の既定ブレインである `codex` は使えません。PATH、Codex CLI のバージョン、ログイン状態、Codex CLI の設定を確認してください。

Codex CLI の `app-server` は CLI 側で experimental と表示される場合があります。Ji-Danmaku はこの app-server の stdio JSON-RPC を使って弾幕生成を行います。

## セットアップ

```powershell
npm install
```

起動します。

```powershell
npm start
```

起動すると、次が開きます。

- コントロール画面
- 透明な弾幕オーバーレイ
- Windows 通知領域アイコン

通知領域にアイコンが隠れている場合は、Windows の「隠れているインジケーター」内を確認してください。表示名は `Ji-Danmaku` です。

## リリース版のインストールと更新

GitHub Releases から通常インストールする場合は、`Ji-Danmaku-Setup-<version>-<arch>.exe` を使ってください。

Setup 版は Windows のインストール済みアプリとして登録されます。次回以降の Setup 版では同じアプリ ID / NSIS GUID を使うため、既存の Ji-Danmaku を検出して同じインストール先を更新します。インストール先を変更するページは出さず、別フォルダへの二重インストールを避ける設定にしています。

更新インストールではアプリ本体だけを入れ替え、ユーザー設定は保持します。Portable 版の `Ji-Danmaku-Portable-<version>-<arch>.exe` はインストール済みアプリの更新には使わず、単体実行用として扱ってください。

## 基本操作

| 操作 | 内容 |
| --- | --- |
| F8 | 弾幕の開始 / 停止 |
| F7 | コントロール画面を前面に呼び出す |
| F9 | 緊急停止 |
| 通知領域アイコン左クリック | コントロール画面を表示 |
| 通知領域アイコン右クリック | 開始、停止、緊急停止、終了 |

F9 の緊急停止は、画面キャプチャ、弾幕送出、マイク監視を止めるための安全操作です。

## 設定

設定は `%APPDATA%\ji-danmaku\config.json` に保存されます。コントロール画面から変更できます。

主な設定は次の通りです。

| 項目 | 既定値 | 内容 |
| --- | --- | --- |
| ブレイン | `codex` | `codex` / `mock` |
| 反応バランス | `70` | 0=画面中心、100=声のみ、70=声を主役に画面も補助 |
| マイク監視 | ON | 音量を検知して発話反応を増やす |
| 文字起こし | ON | 発話内容を AI に渡す |
| 音声認識 | `local` | ローカル Whisper。追加 API 課金なし |
| フィラー弾幕 | OFF | AI 生成の隙間に軽い弾幕を流す |
| NG ワード | ON | 指定語を除外または伏字化 |
| マルチモニター | ON | 全ディスプレイに弾幕を表示 |
| Zoom/OBS 共有 | `弾幕を共有に映す` | 画面共有や OBS の Display Capture に弾幕を含める |
| 緊急停止キー | `F9` | すぐに停止するショートカット |

`Zoom/OBS 共有` は、コントロール画面の `プライバシー・緊急停止` から変更できます。

- `弾幕を共有に映す`: 既定。Zoom の全画面共有や OBS の画面キャプチャに弾幕を含めます。
- `AIスクショから隠す（自動）`: Windows 10 version 2004 以降では、弾幕を画面キャプチャから除外します。AI に渡すスクリーンショットへ自分の弾幕を写したくない場合に使います。
- `AIスクショから隠す（強制）`: 常にキャプチャ除外を試みます。古い Windows では黒画面化する場合があるため、通常は使わないでください。

Zoom や OBS に弾幕を映したい場合は、`弾幕を共有に映す` を選んでください。`AIスクショから隠す` 系の設定では、Zoom / OBS 側からも弾幕が見えなくなることがあります。設定変更やディスプレイ構成変更でオーバーレイが作り直された場合も、文字サイズ、速度、透明度、余白設定は読み込み完了後に再適用されます。

## AI ブレイン

### Codex

既定のブレインです。Codex CLI の `codex app-server` を使います。

Ji-Danmaku は app-server を 1 本だけ常駐させ、短い ephemeral thread で弾幕を生成します。長時間稼働で詰まりにくいよう、turn timeout、request timeout、watchdog、定期 recycle、process tree cleanup を行います。

Codex モードでは、弾幕生成のために次の情報が Codex app-server へ渡ります。

- 生成プロンプト
- 直近の発話文字起こし
- 前面アプリ名、ウィンドウタイトル
- 必要に応じたスクリーンショット画像
- 直近に流れた弾幕の一部

つまり、Codex モードで画面反応を使う場合、画面情報や発話テキストは Codex 側の処理に渡ります。機密情報を扱う画面では使用しないか、プライバシー除外を設定してください。

声 100% モードでは、現在の turn にはスクリーンショットや画面文脈を渡しません。また、画面あり生成と声 100% 生成で Codex thread を分け、過去の画面文脈が混ざらないようにしています。

### mock

AI を使わない簡易ブレインです。Codex CLI が使えないときの確認、デモ、退避に使えます。画面理解や発話内容への深い反応は行いません。

## 音声認識

### ローカル Whisper

既定の音声認識です。Transformers.js / Whisper モデルを使い、この PC 上で文字起こしします。初回はモデルをダウンロードし、以降はキャッシュから使います。
既定モデルは `Xenova/whisper-base` です。反応速度を優先し、精度を上げたい場合はコントロール画面で `small` 以上に切り替えてください。

ローカル Whisper 自体は音声を外部に送信しません。ただし、ブレインが `codex` の場合、文字起こし結果は弾幕生成プロンプトとして Codex app-server に渡ります。

## プライバシーと注意事項

このアプリは画面キャプチャとマイクを扱います。配信、録画、画面共有、業務端末で使う場合は特に注意してください。

重要な注意点:

- Codex モードでは、画面情報、発話テキスト、スクリーンショットが Codex app-server 経由で AI 生成に使われます。
- ローカル Whisper は音声を外部送信しませんが、その文字起こし結果は選択中の AI ブレインに渡ります。
- パスワード、認証コード、個人情報、社外秘資料、医療・金融・法務情報などが画面に出ている状態で使わないでください。
- プライバシー除外設定を使うと、特定プロセス名やウィンドウタイトルではキャプチャと AI 生成を止められます。

既定のプライバシー除外には、パスワード管理アプリやログイン画面に関する一般的なルールが含まれます。ただし完全ではありません。必要に応じて追加してください。

## 料金について

Codex ブレインは OpenAI API キーによる従量課金ではなく、ローカルの Codex CLI ログイン状態を使います。ただし、利用可否、利用上限、契約条件は Codex CLI / アカウント側の状態に依存します。

## トラブルシューティング

### Codex が使えない

次を確認してください。

```powershell
codex --version
codex app-server --help
codex login
```

確認ポイント:

- Codex CLI がインストールされている
- `codex` が PATH に入っている
- `codex login` 済み
- `codex app-server --help` が成功する
- セキュリティソフトが `codex app-server` の起動を止めていない

### 弾幕が出ない

- F8 で開始されているか確認
- コントロール画面のステータスを確認
- ブレインが `codex` の場合は Codex CLI の状態を確認
- 画面変化がなく、アイドル検知で AI 生成をスキップしていないか確認
- NG ワード設定でコメントが除外されていないか確認
- 緊急停止後は再度開始する

### Zoom / OBS の共有に弾幕が映らない

- コントロール画面の `プライバシー・緊急停止` で `Zoom/OBS 共有` が `弾幕を共有に映す` になっているか確認
- OBS では `画面キャプチャ` / `Display Capture` を使う。`ウィンドウキャプチャ` や `ゲームキャプチャ` は対象アプリだけを拾うため、別ウィンドウの弾幕オーバーレイが映らない場合があります
- Zoom では画面全体または対象ディスプレイを共有する。単一ウィンドウ共有では、別ウィンドウの弾幕オーバーレイが含まれない場合があります
- `AIスクショから隠す（自動）` または `AIスクショから隠す（強制）` を選んでいる場合は、共有ソフト側にも弾幕が映らないことがあります
- 設定を変えた直後に反映されない場合は、F8 で停止/開始するか、アプリを再起動してください

### 通知領域アイコンが見えない

- Windows の隠れているインジケーターを開く
- `Ji-Danmaku` があるか確認
- ない場合はアプリを終了して再起動
- それでも出ない場合は `npm start` のログと Electron プロセスの状態を確認

### マイクに反応しない

- コントロール画面でマイク監視が ON か確認
- Windows のマイク権限を確認
- 入力デバイスが正しいか確認
- マイクしきい値が高すぎないか確認
- ローカル Whisper のモデル初回ダウンロードが終わっているか確認

## 開発コマンド

```powershell
npm install
npm start
npm test
```

構文チェック:

```powershell
$files = rg --files -g "*.js" -g "!node_modules/**"
foreach ($f in $files) {
  node --check $f
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Windows 用ビルド:

```powershell
npm run dist
```

生成物は `dist/` に出ます。

## ディレクトリ構成

```text
electron/
  main.js              Electron メインプロセス、ウィンドウ、トレイ、キャプチャループ
  preload.js           Renderer への IPC ブリッジ
  config.js            設定の読み書き
  screen.js            前面ウィンドウ情報とスクリーンショット取得
  ai/
    index.js           AI ブレインの切り替えと fallback
    codex.js           Codex app-server 連携
    mock.js            AI 不使用の弾幕生成

renderer/
  control.html         コントロール画面
  control.css
  control.js
  overlay.html         透明オーバーレイ
  overlay.css
  overlay.js
  whisper-worker.js    ローカル Whisper 用 worker

build/
  icon.ico             Windows アプリ / 通知領域アイコン
  icon.png
  icon.svg

test/
  *.test.js            node:test ベースのテスト
```

## ライセンス

Ji-Danmaku 本体は MIT License です。詳細は `LICENSE` を参照してください。

依存ライブラリ、Electron / Chromium、Whisper モデル、Codex CLI には、それぞれのライセンス、利用規約、料金条件が適用されます。詳細は `THIRD_PARTY_NOTICES.md` と各サービスの公式情報を確認してください。
