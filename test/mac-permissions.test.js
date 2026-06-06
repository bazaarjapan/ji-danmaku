'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  accessibilityPermissionItem,
  labelForMediaStatus,
  microphonePermissionItem,
  screenPermissionItem
} = require('../electron/mac-permissions');

test('labelForMediaStatus maps Electron permission statuses', () => {
  assert.equal(labelForMediaStatus('granted'), '許可済み');
  assert.equal(labelForMediaStatus('denied'), '拒否されています');
  assert.equal(labelForMediaStatus('restricted'), '制限されています');
  assert.equal(labelForMediaStatus('not-determined'), '未確認');
});

test('screenPermissionItem treats screen capture denial as setup error', () => {
  assert.equal(screenPermissionItem('granted').status, 'ok');
  assert.equal(screenPermissionItem('not-determined').status, 'warn');
  assert.equal(screenPermissionItem('denied').status, 'error');
});

test('microphonePermissionItem is optional when voice features are disabled', () => {
  assert.equal(microphonePermissionItem('denied', false).status, 'ok');
  assert.equal(microphonePermissionItem('denied', true).status, 'warn');
});

test('accessibilityPermissionItem is a warning when missing', () => {
  assert.equal(accessibilityPermissionItem(true).status, 'ok');
  assert.equal(accessibilityPermissionItem(false).status, 'warn');
});
