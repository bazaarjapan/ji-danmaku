'use strict';

const TONES = {
  balanced: '標準。共感、ツッコミ、実況、笑い、感心を偏らせず自然に混ぜる。',
  gentle: 'やさしめ。肯定、共感、ねぎらいを多めにし、イジりや強いツッコミは控える。',
  tsukkomi: 'ツッコミ多め。軽いツッコミや茶化しを増やすが、煽りや攻撃的表現は禁止。',
  kusa: '草多め。w、草、笑いの反応を少し増やすが、同じ笑いだけを連発しない。',
  live: '実況多め。今起きたこと、展開、操作、画面変化への短い実況を増やす。',
  polite: '敬語寄り。ですます調、丁寧な相づち、落ち着いた称賛を増やす。',
  calm: '落ち着きめ。短く静かな相づち、感心、観察を増やし、叫びや連投感を控える。'
};

function normalizeTone(value) {
  return Object.prototype.hasOwnProperty.call(TONES, value) ? value : 'balanced';
}

function toneInstruction(value) {
  return TONES[normalizeTone(value)];
}

module.exports = {
  TONES,
  normalizeTone,
  toneInstruction
};
