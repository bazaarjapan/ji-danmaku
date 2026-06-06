// ローカル Whisper (Transformers.js / onnxruntime-web WASM) を回す Web Worker。
//
// 方針:
//  - 推論はこの Worker 内だけで完結 → UIスレッド(コントロール画面)も弾幕も固まらない。
//  - WASM ランタイムは【ローカルの node_modules】から読む → 起動ごとのCDN取得が不要。
//  - モデルは初回だけ HuggingFace からDLし、ブラウザキャッシュに保存 → 2回目以降はオフライン・無料。
//  - 追加の従量課金は一切なし(全部このPCのCPUで動く)。
//
// 注意: SharedArrayBuffer(マルチスレッド)が使えない環境ではORTが単一スレッドへ自動フォールバック。
//       少し遅くなるが動作はする。生成ループは15秒間隔なので数秒の文字起こし遅延は許容範囲。

// transformers.js は onnxruntime-web を内包した自己完結ビルド(バンドラ不要)。
// .web.js は bare import を含みブラウザ/Workerで直接読めないので使わない。
import { pipeline, env } from '../node_modules/@huggingface/transformers/dist/transformers.js';

// --- 実行環境の設定 -----------------------------------------------------
// WASM バイナリ(.wasm/.mjs)はローカルの onnxruntime-web から読む。
env.backends.onnx.wasm.wasmPaths = new URL(
  '../node_modules/onnxruntime-web/dist/',
  import.meta.url
).href;
// クロスオリジン分離なし環境ではスレッドが使えないため単一スレッドに固定(エラー回避)。
env.backends.onnx.wasm.numThreads = 1;
// モデルはHubから取得しブラウザキャッシュへ。ローカル(file://の/models)探索は無効。
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

let transcriber = null;
let loading = null;
let busy = false;

function buildPipeline(model, device) {
  return pipeline('automatic-speech-recognition', model, {
    // 既定の量子化(NBits)デコーダは onnxruntime-web で読めないことがあるため fp32 を明示。
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'fp32' },
    device,
    progress_callback: (p) => {
      if (p && (p.status === 'progress' || p.status === 'done' || p.status === 'ready')) {
        self.postMessage({ type: 'progress', status: p.status, file: p.file, progress: p.progress });
      }
    }
  });
}

async function load(model) {
  if (transcriber) return transcriber;
  if (loading) return loading;
  // WebGPU が使えれば高速。ダメなら WASM(CPU) へ自動フォールバック。
  loading = (async () => {
    let device = 'wasm';
    try {
      if (typeof navigator !== 'undefined' && navigator.gpu && await navigator.gpu.requestAdapter()) {
        device = 'webgpu';
      }
    } catch { device = 'wasm'; }
    try {
      transcriber = await buildPipeline(model, device);
    } catch (e) {
      if (device === 'webgpu') {
        self.postMessage({ type: 'progress', status: 'progress', file: 'webgpu→wasmへ切替', progress: 0 });
        device = 'wasm';
        transcriber = await buildPipeline(model, 'wasm');
      } else {
        throw e;
      }
    }
    self.postMessage({ type: 'ready', model, device });
    return transcriber;
  })().catch((e) => {
    loading = null;
    self.postMessage({ type: 'error', message: String(e && e.message || e) });
    throw e;
  });
  return loading;
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};

  if (msg.type === 'load') {
    try { await load(msg.model); } catch {}
    return;
  }

  if (msg.type === 'transcribe') {
    if (busy) { self.postMessage({ type: 'skipped' }); return; }
    busy = true;
    try {
      const t = await load(msg.model);
      // Float32Array(16kHz mono) をそのまま渡す。日本語固定で文字起こし。
      const out = await t(msg.audio, {
        language: 'japanese',
        task: 'transcribe',
        chunk_length_s: 30,
        // 短い相づち等の繰り返し暴走を軽く抑制
        no_repeat_ngram_size: 3
      });
      const text = (out && typeof out.text === 'string') ? out.text.trim() : '';
      self.postMessage({ type: 'result', text });
    } catch (e) {
      self.postMessage({ type: 'error', message: String(e && e.message || e) });
    } finally {
      busy = false;
    }
  }
};
