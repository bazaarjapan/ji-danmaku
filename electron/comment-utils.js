'use strict';

const DEFAULT_RECENT_AI_TTL = 45000;

function normalizeCommentText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '').replace(/[。、!！?？w～~ー]+$/g, '');
}

function normalizeNgWords(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '').split(/[\r\n,]+/);
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const word = String(item || '').trim();
    if (!word) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const words = normalizeNgWords(cfg.ngWords || []);
  if (!words.length) return comments;

  const mask = cfg.ngMode === 'mask';
  const out = [];
  for (const comment of comments || []) {
    const text = (comment && comment.text) || '';
    const lowerText = text.toLowerCase();
    if (!words.some((word) => lowerText.includes(word.toLowerCase()))) {
      out.push(comment);
      continue;
    }
    if (mask) {
      let masked = text;
      for (const word of words) {
        const re = new RegExp(escapeRegExp(word), 'gi');
        masked = masked.replace(re, (match) => '〇'.repeat([...match].length));
      }
      out.push({ ...comment, text: masked });
    }
  }
  return out;
}

module.exports = {
  DEFAULT_RECENT_AI_TTL,
  normalizeCommentText,
  normalizeNgWords,
  dedupeAiComments,
  filterNgComments
};
