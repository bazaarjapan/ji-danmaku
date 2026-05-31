'use strict';

function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fence) candidates.push(fence[1]);
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) candidates.push(brace[0]);
  candidates.push(text);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && Array.isArray(parsed.comments)) return parsed;
    } catch {}
  }
  return null;
}

function normalizeComments(payload) {
  return payload.comments
    .filter((comment) => comment && typeof comment.text === 'string' && comment.text.trim())
    .map((comment) => ({
      text: comment.text.trim().slice(0, 40),
      style: {
        ...(typeof comment.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(comment.color) ? { color: comment.color } : {}),
        ...(comment.big === true ? { big: true } : {}),
        ...(comment.small === true ? { small: true } : {}),
        ...(comment.pos === 'ue' || comment.pos === 'shita' ? { pos: comment.pos } : {})
      }
    }));
}

module.exports = { extractJson, normalizeComments };
