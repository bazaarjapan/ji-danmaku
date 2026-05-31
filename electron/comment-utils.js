'use strict';

const DEFAULT_RECENT_AI_TTL = 45000;

function normalizeCommentText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '').replace(/[。、!！?？w～~ー]+$/g, '');
}

function dedupeAiComments(comments, recent, options = {}) {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_RECENT_AI_TTL;
  const nextRecent = (recent || []).filter((item) => now - item.at < ttlMs);
  const seen = new Set(nextRecent.map((item) => item.n));
  const out = [];

  for (const comment of comments || []) {
    const normalized = normalizeCommentText(comment && comment.text);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    nextRecent.push({ n: normalized, text: comment.text, at: now });
    out.push(comment);
  }

  return { comments: out, recent: nextRecent };
}

function filterNgComments(comments, cfg = {}) {
  const words = (cfg.ngWords || []).map((word) => String(word || '')).filter(Boolean);
  if (!words.length) return comments;

  const mask = cfg.ngMode === 'mask';
  const out = [];
  for (const comment of comments || []) {
    const text = (comment && comment.text) || '';
    if (!words.some((word) => text.includes(word))) {
      out.push(comment);
      continue;
    }
    if (mask) {
      let masked = text;
      for (const word of words) {
        masked = masked.split(word).join('〇'.repeat([...word].length));
      }
      out.push({ ...comment, text: masked });
    }
  }
  return out;
}

module.exports = {
  DEFAULT_RECENT_AI_TTL,
  normalizeCommentText,
  dedupeAiComments,
  filterNgComments
};
