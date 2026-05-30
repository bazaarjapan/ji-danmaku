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
let lanes = [];          // 各レーンが「次に空く時刻(ms)」
let laneHeight = 40;

function rebuildLanes() {
  laneHeight = Math.round(style.fontSize * 1.35);
  const count = Math.max(4, Math.floor(window.innerHeight / laneHeight));
  lanes = new Array(count).fill(0);
}
rebuildLanes();
window.addEventListener('resize', rebuildLanes);

// 弾幕の幅(おおよそ)から、衝突しないレーンを選ぶ。
function pickLane(durationMs, estWidthPx) {
  const now = performance.now();
  const screenW = window.innerWidth;
  // 弾幕が画面右端を完全に抜けるまでの時間 = 後続が同レーンに入れるまでの猶予。
  // 速度 = (screenW + width) / duration。先頭が左に width 進めば安全。
  const speed = (screenW + estWidthPx) / durationMs;
  const clearTime = now + estWidthPx / speed + 120; // この時刻まで占有

  // 空いている(=占有終了が過ぎている)レーンを上から探す
  let best = -1;
  let bestFree = Infinity;
  for (let i = 0; i < lanes.length; i++) {
    if (lanes[i] <= now) { best = i; break; }
    if (lanes[i] < bestFree) { bestFree = lanes[i]; best = i; }
  }
  lanes[best] = clearTime;
  return best;
}

function spawn(comment) {
  if (onScreen >= style.maxOnScreen) return;

  const el = document.createElement('div');
  el.className = 'danmaku' + (comment.style && comment.style.big ? ' big' : '');
  el.textContent = comment.text;

  const fs = style.fontSize * (comment.style && comment.style.big ? 1.0 : 1.0);
  el.style.fontSize = fs + 'px';
  el.style.opacity = String(style.opacity);
  if (comment.style && comment.style.color) el.style.color = comment.style.color;
  el.style.animation = 'pop 120ms linear';

  // 一旦不可視で配置して幅を測る
  el.style.visibility = 'hidden';
  el.style.transform = 'translate(100vw, 0)';
  stage.appendChild(el);
  const width = el.offsetWidth || comment.text.length * fs;

  // 速度は基準 speedMs を中心に少し揺らぐ（生き物感）
  const duration = style.speedMs * (0.85 + Math.random() * 0.4);
  const lane = pickLane(duration, width);
  const y = lane * laneHeight + 2;

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

  const cleanup = () => {
    if (el._done) return;
    el._done = true;
    el.remove();
    onScreen--;
  };
  el.addEventListener('transitionend', cleanup);
  // 保険のタイマー（transitionend を取りこぼしても消す）
  setTimeout(cleanup, duration + 500);
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
