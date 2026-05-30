'use strict';

// 任意の代替ブレイン: Claude (Anthropic API) のビジョンで弾幕を生成。
// 環境変数 ANTHROPIC_API_KEY が必要。SDK 不要、fetch で直接叩く。

const fs = require('fs');

const SYSTEM = [
  'あなたはニコニコ動画/ライブ配信の視聴者です。',
  '与えられた画面のスクリーンショットに対し、リアルタイムに流れる',
  '短い視聴者コメント(弾幕)を生成します。各コメントは日本語で最大20文字、',
  'ネットスラング(w, 草, 888, kawaii 等)や実況の相づちを混ぜ、明るく楽しく。',
  '誹謗中傷や不適切表現は避ける。',
  'JSON のみを返す: {"comments":[{"text":"...","color":"#rrggbb"(任意),"big":true(任意)}]}'
].join('');

async function generate({ count, context, transcript, imagePath, model, maxTokens }) {
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
  const voice = transcript ? ` 配信者の発話:「${transcript}」` : '';
  content.push({
    type: 'text',
    text: `この画面に反応する弾幕を${count}個、JSONで。${ctx}${voice}`
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
