'use strict';

// ニコニコ動画風 弾幕エンジン。
// - 右端から左端へ一定時間で流れる（CSS transform / GPU 合成）
// - レーン(行)管理で重なりを最小化
// - 大型/色付き対応、同時数の上限ガード

const stage = document.getElementById('stage');

let style = {
  fontSize: 30,
  speedMs: 8000,
  opacity: 0.92,
  maxOnScreen: 120
};

let onScreen = 0;
let lanes = [];          // 各レーンが「次に空く時刻(ms)」（流れる弾幕用）
let ueLanes = [];        // 上固定(ue)コメントの行占有
let shitaLanes = [];     // 下固定(shita)コメントの行占有
let laneHeight = 40;
const FIXED_MS = 4000;   // 上下固定コメントの表示時間(ms)

function rebuildLanes() {
  laneHeight = Math.round(style.fontSize * 1.35);
  const count = Math.max(4, Math.floor(window.innerHeight / laneHeight));
  lanes = new Array(count).fill(0);
  ueLanes = new Array(count).fill(0);
  shitaLanes = new Array(count).fill(0);
}
rebuildLanes();
window.addEventListener('resize', rebuildLanes);

// 弾幕の幅(おおよそ)から、衝突しないレーンを選ぶ。
// span: 縦に占有するレーン数（big は背が高いので2レーン分確保して重なりを防ぐ）。
function pickLane(durationMs, estWidthPx, span = 1) {
  const now = performance.now();
  const screenW = window.innerWidth;
  // 弾幕が画面右端を完全に抜けるまでの時間 = 後続が同レーンに入れるまでの猶予。
  // 速度 = (screenW + width) / duration。先頭が左に width 進めば安全。
  const speed = (screenW + estWidthPx) / durationMs;
  const clearTime = now + estWidthPx / speed + 120; // この時刻まで占有

  // span 連続レーンの「最も早く空くブロック」を上から探す（下端はみ出しはクランプ）。
  const maxStart = Math.max(0, lanes.length - span);
  let best = 0;
  let bestScore = Infinity;       // ブロック内で最も遅い占有終了時刻
  for (let i = 0; i <= maxStart; i++) {
    let score = 0;
    for (let k = 0; k < span; k++) score = Math.max(score, lanes[i + k]);
    if (score <= now) { best = i; break; }     // 完全に空いている
    if (score < bestScore) { bestScore = score; best = i; }
  }
  for (let k = 0; k < span; k++) lanes[best + k] = clearTime;
  return best;
}

function spawn(comment) {
  if (onScreen >= style.maxOnScreen) return;

  const st = comment.style || {};
  const big = !!st.big;
  const small = !big && !!st.small;                       // big を優先
  const pos = (st.pos === 'ue' || st.pos === 'shita') ? st.pos : null;

  const el = document.createElement('div');
  el.className = 'danmaku'
    + (big ? ' big' : '') + (small ? ' small' : '') + (pos ? ' fixed' : '');
  el.textContent = comment.text;

  // big=拡大 / small=縮小 / 固定=等倍 / 通常流れる=軽いゆらぎ。
  const sizeMul = big ? 1.6 : small ? 0.72 : (pos ? 1.0 : 0.9 + Math.random() * 0.25);
  const fs = Math.round(style.fontSize * sizeMul);
  el.style.fontSize = fs + 'px';
  el.style.opacity = String(style.opacity);
  if (st.color) el.style.color = st.color;
  el.style.animation = 'pop 120ms linear';

  // 一旦不可視で配置して幅を測る
  el.style.visibility = 'hidden';
  el.style.transform = 'translate(100vw, 0)';
  stage.appendChild(el);
  const width = el.offsetWidth || comment.text.length * fs;

  const cleanup = () => {
    if (el._done) return;
    el._done = true;
    el.remove();
    onScreen--;
  };

  // ニコ動の ue/shita 固定コメント: 画面中央寄せで数秒静止 → フェードアウト。
  if (pos) {
    const rows = pos === 'ue' ? ueLanes : shitaLanes;
    const now = performance.now();
    let row = rows.findIndex((t) => t <= now);
    if (row < 0) row = 0;                       // 満杯なら先頭に重ねる
    rows[row] = now + FIXED_MS;
    const y = pos === 'ue'
      ? row * laneHeight + 2
      : window.innerHeight - (row + 1) * laneHeight + 2;
    el.style.left = '50%';
    el.style.top = y + 'px';
    el.style.transform = 'translateX(-50%)';
    el.style.visibility = 'visible';
    onScreen++;
    setTimeout(() => { el.style.transition = 'opacity 400ms linear'; el.style.opacity = '0'; }, FIXED_MS - 400);
    setTimeout(cleanup, FIXED_MS);
    return;
  }

  // 流れる弾幕: 速度は基準 speedMs を中心に少し揺らぐ（生き物感）
  const duration = style.speedMs * (0.85 + Math.random() * 0.4);
  // big は背が高いので2レーン確保。予約ブロック内で縦センタリングして重なりを防ぐ。
  const span = big ? 2 : 1;
  const lane = pickLane(duration, width, span);
  const blockH = span * laneHeight;
  const y = lane * laneHeight + Math.max(0, (blockH - fs) / 2);

  el.style.top = y + 'px';
  el.style.visibility = 'visible';

  // 右端外 → 左端外 へ
  const startX = window.innerWidth;
  const endX = -width - 10;
  el.style.transform = `translate(${startX}px, 0)`;

  onScreen++;

  // 次フレームで transition を仕掛けて流す
  requestAnimationFrame(() => {
    el.style.transition = `transform ${duration}ms linear`;
    el.style.transform = `translate(${endX}px, 0)`;
  });

  el.addEventListener('transitionend', cleanup);
  // 保険のタイマー（transitionend を取りこぼしても消す）
  setTimeout(cleanup, duration + 500);
}

function clearDanmaku() {
  for (const child of Array.from(stage.children)) child._done = true;
  stage.replaceChildren();
  onScreen = 0;
  rebuildLanes();
}

// ---- IPC 受信 ----------------------------------------------------------

window.ji.onStyle((s) => {
  style = { ...style, ...s };
  rebuildLanes();
});

window.ji.onDanmaku(({ comments }) => {
  if (!comments) return;
  for (const c of comments) spawn(c);
});

window.ji.onClearDanmaku(clearDanmaku);
