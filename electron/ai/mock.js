'use strict';

// AI が無くても軽い賑わいを出すためのアンビエントリアクション生成。
// 汎用的な短文リアクションを中心に、文脈ワードを少し混ぜる。

const { normalizeTone } = require('./comment-tone');

const REACTIONS = [
  // 笑い
  'www', 'wwwww', 'ｗｗｗ', '草', '大草原', '草生える', '草不可避', '笑った',
  'ツボったw', '腹いてえw', 'じわるw', 'なんでやねんw', '笑うわこんなん',
  // 称賛・感心
  'すごい', 'すごすぎ', 'うまい', 'お上手', '天才', '神', '神回', 'プロやん',
  'さすがやな', 'レベル高い', 'ナイス', 'GJ', '偉い', '尊敬する', 'お見事',
  'えぐいうまい', 'センスある',
  // 共感・同意
  'わかる', 'わかりみ', 'それな', 'たしかに', 'せやな', 'ほんそれ', '同意',
  'まじでそれ', '完全に理解した', 'あるある',
  // かわいい・尊い
  'かわいい', 'kawaii', '尊い', 'てえてえ', 'すき', 'ぐうかわ', 'ほっこり', 'すこ',
  // 驚き
  'おお', 'まじか', 'ファッ!?', 'ええ…', 'うせやろ', 'なにそれ', 'びっくり',
  'マ?', 'は、はやい', '初めて見た',
  // 盛り上がり
  '888888', 'ぱちぱち', 'うおおおお', 'きたあああ', '最高', '優勝', 'はい優勝',
  '沸いた', 'テンション上がる', '盛り上がってきた', 'ここすき',
  // まったり・雰囲気
  'ふむ', 'なるほど', 'へえ', 'ほー', 'いいね', 'よき', '平和', '癒される',
  'いい雰囲気', '落ち着く', 'BGMいいね', '作業用に最適', 'ずっと見てられる',
  // 質問・実況的
  'これ何してるの？', 'どうやるの？', '次どうするん？', 'なんでそうなった？',
  '解説して〜', 'お、何か始まった', 'おっ', 'ここ大事そう',
  // 視聴者ムーブ
  '初見です', 'こんばんは', 'おつ', 'おつかれ', 'ノシ', 'wktk', 'がんばれ',
  'いけぇ', 'どんまい', 'ナイスファイト', '見入ってる', '配信たのし'
];

// 絵文字・顔文字（たまに流す）
const EMOJI = ['👏', '🔥', '😂', '✨', '🎉', '💯', '😭', '👀', '🙌', '❤️',
  '😆', '😳', '🥳', '👍', '🤣', '😍', '🥺', '💪', '🙏', '⭐', '🎏', '🌸',
  '😎', '🤔', '😱', '🫶', '🥹'];
const KAOMOJI = ['(°▽°)', '( ﾟдﾟ)', 'ｷﾀ━(ﾟ∀ﾟ)━!', '( ´∀｀)', '(๑˃̵ᴗ˂̵)',
  '\\(^o^)/', '(；・∀・)', '( ˘ω˘)', '(ﾉ´∀`)ﾉ'];

const TONE_WORDS = {
  balanced: [],
  gentle: ['いいね', 'ほっとする', '無理せず', 'やさしい', '助かる', 'えらい', 'いい感じ', '見守ってる'],
  tsukkomi: ['なんでやねんw', 'そこ!?', 'そうはならんw', '急にどうしたw', 'ツッコミ待ちかw', 'そこかいw'],
  kusa: ['www', '草', '大草原', '草生える', '笑ったw', 'じわる', 'これは草', '腹いてえw'],
  live: ['今の何!?', '展開きた', 'お、動いた', 'ここ大事そう', '流れ変わった', '今の良い', '次どうなる'],
  polite: ['すごいです', '助かります', 'いいですね', 'なるほどです', 'お見事です', 'わかります', '丁寧ですね'],
  calm: ['なるほど', 'ふむ', '静かに見たい', 'いい流れ', '落ち着く', 'じっくり見てる', 'これは良い']
};

const TYPED_BY_KEYWORD = [
  { re: /(code|vs ?code|cursor|terminal|powershell|cmd|\.js|\.ts|\.py|github|git)/i,
    words: ['ｺｰﾄﾞ書いてる', 'エンジニアやん', 'バグはよ直して', 'console.log()', 'うごけ〜',
      'コンパイル通れ', '天才プログラマー', 'リファクタしろw', 'インデント気になるw', 'コミットはよ',
      'そのエラー見たことある', 'AIに聞こ？', 'プルリク出して', 'テスト書いた？', '動いた888'] },
  { re: /(youtube|video|動画|netflix|prime|映画|配信|live)/i,
    words: ['いいセンスw', 'これ好き', '音でかいw', 'うぽつ', '名作', 'タイムシフト勢',
      'ここすこ', '神シーン', 'もう一回見たい', 'BGMなに？'] },
  { re: /(chrome|edge|firefox|browser|google|検索|search)/i,
    words: ['ググってるw', '調べもの乙', 'タブ多すぎw', 'それ知りたい', '検索うまいな',
      'ブクマしとこ', 'サジェスト見えてるw'] },
  { re: /(game|ゲーム|steam|apex|valorant|minecraft|マイクラ|fps|rpg)/i,
    words: ['うまい！', 'GG', 'ナイスエイム', 'どんまい', 'いけぇ！', '神プレイ',
      'そこ右！', 'おしい！', 'うまくなったな', 'ナイスムーブ'] },
  { re: /(slack|teams|discord|gmail|mail|メール|zoom|meet|会議|chat)/i,
    words: ['お仕事お疲れさま', '会議多そう', '返信はよw', '社畜きたあ', 'リモートいいな',
      'メール多すぎw', 'お疲れさまです'] },
  { re: /(excel|spreadsheet|sheet|スプレッド|notion|word|powerpoint|資料|doc)/i,
    words: ['事務作業えらい', '関数つよつよ', '資料神', 'がんばえ〜', 'まとめ上手',
      'そのショートカット便利', '見やすい資料'] },
  { re: /(chatgpt|claude|gpt|ai|copilot|codex|llm|prompt)/i,
    words: ['AI使いこなしてる', 'プロンプト上手い', 'AI時代やね', 'それAIに任せろw',
      'すごい時代になった', 'AIくんがんばえ', '人間の仕事…'] },
  { re: /(figma|photoshop|illustrator|canva|design|デザイン|blender)/i,
    words: ['デザインセンスある', 'おしゃれ', '配色すき', 'プロの仕事', 'きれい〜', 'カッコいい'] },
  { re: /(spotify|music|音楽|daw|ableton|cubase|bgm)/i,
    words: ['この曲すき', '選曲ナイス', 'いい音', 'ノれる', 'プレイリスト教えて'] },
  { re: /(twitter|x\.com|instagram|tiktok|sns|facebook)/i,
    words: ['SNS監視乙w', 'バズってる？', 'いいね押しとくw', 'エゴサ中？'] }
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function toneWords(tone) {
  return TONE_WORDS[normalizeTone(tone)] || TONE_WORDS.balanced;
}

// 1件分のテキストを作る。たまに絵文字のみ/顔文字のみ、語尾に絵文字を添える。
function genText(themed, tone) {
  const r = Math.random();
  if (r < 0.12) return pick(EMOJI);                              // 絵文字のみ
  if (r < 0.17) return pick(KAOMOJI);                            // 顔文字のみ
  const toned = toneWords(tone);
  if (toned.length && Math.random() < 0.45) return pick(toned);
  let text = themed.length && Math.random() < 0.4 ? pick(themed) : pick(REACTIONS);
  if (Math.random() < 0.18) text += pick(EMOJI);                // 語尾に絵文字を添える
  return text;
}

// context: { title, process } を渡すと文脈寄りのコメントが混ざる。
function generate(count, context = {}, tone = 'balanced') {
  const ctx = `${context.title || ''} ${context.process || ''}`;
  const themed = [];
  for (const t of TYPED_BY_KEYWORD) {
    if (t.re.test(ctx)) themed.push(...t.words);
  }
  const out = [];
  for (let i = 0; i < count; i++) {
    const text = genText(themed, tone);
    out.push({ text, style: rollStyle(text) });
  }
  return out;
}

// 内容(感情)に応じた控えめなアクセント色。基本は白、ところどころに色を付ける。
// 一致したら色を返し、しなければ null（=白のまま）。
const ACCENT = [
  { re: /(888|８８８|ぱち|拍手|うぽつ|おつ|乙)/, color: '#ffd24d' },                 // 金: 称賛/拍手
  { re: /(かわいい|かわよ|kawaii|尊い|てえてえ|すこ|すき|♡|❤|💕)/i, color: '#ff8ec7' }, // 桃: かわいい
  { re: /(神|優勝|最高|天才|すごい|うますぎ|うま[いす]|プロ|ナイス|GJ)/i, color: '#ff5b5b' }, // 赤: 興奮/称賛
  { re: /(草|ｗｗ|w{2,}|笑|わろ|おもろ|大草原)/i, color: '#7bff7b' },                  // 緑: 笑い
  { re: /(え[ぇえ]?[!！?？]|まじ|マジ|ファッ|うそ|嘘|[!！]?[?？]{2,}|こわ|やば|ヤバ)/, color: '#5bd1ff' } // 水: 驚き
];

function accentColor(text) {
  const s = String(text || '');
  for (const a of ACCENT) {
    if (a.re.test(s)) return a.color;
  }
  return null;
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

module.exports = { generate, accentColor, toneWords };
