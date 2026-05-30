'use strict';

// 任意の代替ブレイン: Claude (Anthropic API) のビジョンで弾幕を生成。
// 環境変数 ANTHROPIC_API_KEY が必要。SDK 不要、fetch で直接叩く。

const fs = require('fs');

const SYSTEM = [
  'あなたはライブ配信を今まさに見ている大勢の匿名視聴者です。',
  'ニコニコ動画のように画面を流れる短い弾幕を、いろんな視聴者がリアルタイムに',
  '書き込む体で生成します。各コメントは日本語で最大20文字、口語で短く。',
  '反応の種類(ツッコミ/共感/質問/感心/実況/軽いイジり/スラングw,草,888)を混ぜ、',
  '同じ語の連発を避け多様に。画面の"今"の中身に具体的に触れるものを多めに。',
  '配信者の発話があれば直接反応(同意/返答/オウム返し/茶化し)も入れる。',
  '誹謗中傷や不適切表現は避け明るく楽しく。',
  'JSON のみを返す: {"comments":[{"text":"...","color":"#rrggbb"(任意),"big":true(任意)}]}'
].join('');

async function generate({ count, context, transcript, imagePath, recent, model, maxTokens }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const content = [];
  if (imagePath && fs.existsSync(imagePath)) {
    const b64 = fs.readFileSync(imagePath).toString('base64');
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: b64 }
    });
  }
  const ctx = context && (context.title || context.process)
    ? `前面アプリ:${context.process || ''} ウィンドウ:${context.title || ''}` : '';
  const voice = transcript ? ` たった今の配信者の発話:「${transcript}」←これにも直接反応` : '';
  const avoid = recent && recent.length
    ? ` 直前に流れたコメント(繰り返さず別の切り口で):${recent.slice(-12).join(' / ')}`
    : '';
  content.push({
    type: 'text',
    text: `たった今のこの画面に、視聴者としてリアルタイムに反応する弾幕を${count}個、JSONで。${ctx}${voice}${avoid}`
  });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || 'claude-opus-4-8',
        max_tokens: maxTokens || 400,
        system: SYSTEM,
        messages: [{ role: 'user', content }]
      })
    });
    if (!res.ok) {
      console.error('[anthropic] HTTP', res.status);
      return null;
    }
    const data = await res.json();
    const text = (data.content || []).map((c) => c.text || '').join('');
    const j = extractJson(text);
    if (!j) return null;
    return j.comments
      .filter((c) => c && typeof c.text === 'string' && c.text.trim())
      .map((c) => ({
        text: c.text.trim().slice(0, 40),
        style: {
          ...(typeof c.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.color) ? { color: c.color } : {}),
          ...(c.big === true ? { big: true } : {})
        }
      }));
  } catch (e) {
    console.error('[anthropic] 失敗:', e.message);
    return null;
  }
}

function extractJson(text) {
  const brace = text && text.match(/\{[\s\S]*\}/);
  if (!brace) return null;
  try {
    const j = JSON.parse(brace[0]);
    return Array.isArray(j.comments) ? j : null;
  } catch {
    return null;
  }
}

module.exports = { generate };
