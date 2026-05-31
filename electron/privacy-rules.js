'use strict';

function normalizeRuleList(value) {
  if (!value) return [];
  const list = Array.isArray(value)
    ? value
    : String(value).split(/[\r\n,]+/);
  return list
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function normalizeProcessName(value) {
  return String(value || '')
    .trim()
    .replace(/\.exe$/i, '')
    .toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardMatch(value, rule) {
  const re = new RegExp(`^${escapeRegExp(rule).replace(/\\\*/g, '.*')}$`, 'i');
  return re.test(value);
}

function matchProcess(processName, rule) {
  const proc = normalizeProcessName(processName);
  const pattern = normalizeProcessName(rule);
  if (!proc || !pattern) return false;
  if (pattern.includes('*')) return wildcardMatch(proc, pattern);
  return proc === pattern;
}

function matchTitle(title, rule) {
  const text = String(title || '').toLowerCase();
  const pattern = String(rule || '').trim().toLowerCase();
  if (!text || !pattern) return false;
  if (pattern.includes('*')) return wildcardMatch(text, pattern);
  return text.includes(pattern);
}

function findPrivacyExclusion(context, cfg) {
  const rules = cfg && cfg.privacyExclusions ? cfg.privacyExclusions : {};
  if (rules.enabled === false) return { excluded: false };

  const processNames = normalizeRuleList(rules.processNames);
  const titlePatterns = normalizeRuleList(rules.titlePatterns);
  const processName = context && context.process;
  const title = context && context.title;

  const processRule = processNames.find((rule) => matchProcess(processName, rule));
  if (processRule) {
    return {
      excluded: true,
      kind: 'process',
      rule: processRule,
      message: `プライバシー除外中: process=${processRule}`
    };
  }

  const titleRule = titlePatterns.find((rule) => matchTitle(title, rule));
  if (titleRule) {
    return {
      excluded: true,
      kind: 'title',
      rule: titleRule,
      message: `プライバシー除外中: title=${titleRule}`
    };
  }

  return { excluded: false };
}

module.exports = {
  findPrivacyExclusion,
  normalizeProcessName,
  normalizeRuleList
};
