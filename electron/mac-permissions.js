'use strict';

function labelForMediaStatus(status) {
  switch (status) {
    case 'granted':
      return '許可済み';
    case 'denied':
      return '拒否されています';
    case 'restricted':
      return '制限されています';
    case 'not-determined':
      return '未確認';
    default:
      return status ? `不明 (${status})` : '不明';
  }
}

function screenPermissionItem(status) {
  if (status === 'granted') {
    return {
      id: 'mac-screen-permission',
      label: 'macOS 画面収録',
      status: 'ok',
      message: '画面収録は許可済みです',
      action: ''
    };
  }
  return {
    id: 'mac-screen-permission',
    label: 'macOS 画面収録',
    status: status === 'not-determined' ? 'warn' : 'error',
    message: `画面収録: ${labelForMediaStatus(status)}`,
    action: 'システム設定 > プライバシーとセキュリティ > 画面収録で Ji-Reaction を許可してください'
  };
}

function microphonePermissionItem(status, enabled) {
  if (!enabled) {
    return {
      id: 'mac-microphone-permission',
      label: 'macOS マイク',
      status: 'ok',
      message: '音声機能はOFFです',
      action: ''
    };
  }
  if (status === 'granted') {
    return {
      id: 'mac-microphone-permission',
      label: 'macOS マイク',
      status: 'ok',
      message: 'マイクは許可済みです',
      action: ''
    };
  }
  return {
    id: 'mac-microphone-permission',
    label: 'macOS マイク',
    status: 'warn',
    message: `マイク: ${labelForMediaStatus(status)}`,
    action: '音声反応を使う場合は、システム設定 > プライバシーとセキュリティ > マイクで Ji-Reaction を許可してください'
  };
}

function accessibilityPermissionItem(trusted) {
  if (trusted) {
    return {
      id: 'mac-accessibility-permission',
      label: 'macOS アクセシビリティ',
      status: 'ok',
      message: 'アクセシビリティは許可済みです',
      action: ''
    };
  }
  return {
    id: 'mac-accessibility-permission',
    label: 'macOS アクセシビリティ',
    status: 'warn',
    message: '前面アプリ名やウィンドウ名を取得できない可能性があります',
    action: 'アプリ文脈とプライバシー除外を安定させるには、システム設定 > プライバシーとセキュリティ > アクセシビリティで Ji-Reaction を許可してください'
  };
}

module.exports = {
  accessibilityPermissionItem,
  labelForMediaStatus,
  microphonePermissionItem,
  screenPermissionItem
};
