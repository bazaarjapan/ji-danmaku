'use strict';

const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./config');

const LOG_DIR = path.join(CONFIG_DIR, 'logs');
const MAX_LOG_FILES = 14;

let lastPruneStamp = '';

function todayStamp(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function fileStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function logPath(date = new Date()) {
  return path.join(LOG_DIR, `ji-danmaku-${todayStamp(date)}.log`);
}

function ensureLogDir(date = new Date()) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const stamp = todayStamp(date);
  if (lastPruneStamp !== stamp) {
    lastPruneStamp = stamp;
    pruneLogs();
  }
}

function listLogFiles() {
  try {
    return fs.readdirSync(LOG_DIR)
      .filter((name) => /^ji-danmaku-\d{4}-\d{2}-\d{2}\.log$/.test(name))
      .sort();
  } catch {
    return [];
  }
}

function pruneLogs(maxFiles = MAX_LOG_FILES) {
  const files = listLogFiles();
  const remove = files.slice(0, Math.max(0, files.length - maxFiles));
  for (const name of remove) {
    try { fs.unlinkSync(path.join(LOG_DIR, name)); } catch {}
  }
}

function redact(value, key = '') {
  if (value === null || value === undefined) return value;
  if (/(api[_-]?key|token|secret|authorization|password|openaiApiKeyEncrypted)/i.test(key)) {
    return '[redacted]';
  }
  if (typeof value === 'string') {
    return value
      .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***');
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (typeof value === 'object') {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = redact(childValue, childKey);
    }
    return out;
  }
  return value;
}

function write(level, event, details = {}) {
  try {
    const now = new Date();
    ensureLogDir(now);
    const entry = {
      at: now.toISOString(),
      level,
      event,
      details: redact(details)
    };
    fs.appendFileSync(logPath(now), JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.error('[logger] write failed:', e.message);
  }
}

function info(event, details) {
  write('info', event, details);
}

function warn(event, details) {
  write('warn', event, details);
}

function error(event, details) {
  write('error', event, details);
}

function readRecentLines(limit = 80) {
  ensureLogDir();
  const files = listLogFiles().reverse();
  const lines = [];
  for (const name of files) {
    let fileLines = [];
    try {
      fileLines = fs.readFileSync(path.join(LOG_DIR, name), 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .reverse();
    } catch {
      continue;
    }
    for (const line of fileLines) {
      lines.push(line);
      if (lines.length >= limit) return lines.reverse();
    }
  }
  return lines.reverse();
}

function writeDiagnostics(text) {
  ensureLogDir();
  const file = path.join(LOG_DIR, `diagnostics-${fileStamp()}.txt`);
  fs.writeFileSync(file, redact(String(text)), 'utf8');
  return file;
}

module.exports = {
  LOG_DIR,
  MAX_LOG_FILES,
  info,
  warn,
  error,
  pruneLogs,
  readRecentLines,
  redact,
  writeDiagnostics
};
