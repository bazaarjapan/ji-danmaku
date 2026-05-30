'use strict';

// AI が無くても「視聴者がいる」賑わいを出すためのアンビエント弾幕生成。
// ニコニコ動画でよく見るリアクションを中心に、文脈ワードを少し混ぜる。

const REACTIONS = [
  'www', 'wwwww', '草', '大草原', '888888', 'ぱちぱち', 'すごい', 'うまい',
  'かわいい', 'kawaii', 'おお', 'まじか', 'ファッ!?', 'ええ…', 'いいね',
  'ナイス', 'GJ', 'てえてえ', '尊い', 'すき', 'わかる', 'それな', 'はい優勝',
  'ここすき', '神', '天才', 'プロやな', 'うおおおお', 'きたあああ', 'よき',
  'おつ', 'おつかれ', 'ふむ', 'なるほど', '？？？', 'wktk', 'がんばれ',
  'いいぞ', 'すこ', 'control room から失礼します', '初見です', 'ノシ'
];

const TYPED_BY_KEYWORD = [
  { re: /(code|vs ?code|cursor|terminal|powershell|cmd|\.js|\.ts|\.py)/i,
    words: ['ｺｰﾄﾞ書いてる', 'エンジニアやん', 'バグはよ', 'console.log()', 'うごけ〜', 'コンパイル通れ', '天才プログラマー', 'リファクタしろ'] },
  { re: /(youtube|video|動画|netflix|prime|映画)/i,
    words: ['いいセンスw', 'これ好き', '音でかいw', 'うぽつ', '名作', 'タイムシフト勢'] },
  { re: /(chrome|edge|firefox|browser|google|検索)/i,
    words: ['ググってるw', '調べもの乙', 'タブ多すぎw', 'それ知りたい'] },
  { re: /(game|ゲーム|steam|apex|valorant|minecraft|マイクラ)/i,
    words: ['うまない！', 'GG', 'ナイスエイム', 'どんまい', 'いけぇ！', '神プレイ'] },
  { re: /(slack|teams|discord|gmail|mail|メール|zoom|meet)/i,
    words: ['お仕事お疲れさま', '会議多そう', '返信はよw', '社畜きたあ'] },
  { re: /(excel|spreadsheet|sheet|スプレッド|notion|word|powerpoint|資料)/i,
    words: ['事務作業えらい', '関数つよつよ', '資料神', 'がんばえ〜'] }
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// context: { title, process } を渡すと文脈寄りのコメントが混ざる。
function generate(count, context = {}) {
  const ctx = `${context.title || ''} ${context.process || ''}`;
  const themed = [];
  for (const t of TYPED_BY_KEYWORD) {
    if (t.re.test(ctx)) themed.push(...t.words);
  }
  const out = [];
  for (let i = 0; i < count; i++) {
    // 文脈ワードがあれば 40% で採用、それ以外は汎用リアクション。
    const text =
      themed.length && Math.random() < 0.4 ? pick(themed) : pick(REACTIONS);
    out.push({ text, style: rollStyle(text) });
  }
  return out;
}

// たまに色付き・大型コメントを混ぜて画面に変化を出す。
function rollStyle(text) {
  const r = Math.random();
  if (r < 0.06) return { color: '#ff5b5b', big: true };   // 赤・大
  if (r < 0.12) return { color: '#ffe14d' };               // 黄
  if (r < 0.17) return { color: '#5bd1ff' };               // 水色
  if (r < 0.21) return { color: '#7bff7b' };               // 緑
  if (/8{3,}|ぱち|拍手/.test(text)) return { color: '#ffd24d' };
  return {};
}

module.exports = { generate };
