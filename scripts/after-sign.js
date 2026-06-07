'use strict';

const { notarize } = require('@electron/notarize');
const { cleanupXattrs } = require('./mac-xattrs');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function notarizationCredentials() {
  if (process.env.APPLE_NOTARY_KEYCHAIN_PROFILE) {
    const credentials = {
      keychainProfile: process.env.APPLE_NOTARY_KEYCHAIN_PROFILE
    };
    if (process.env.APPLE_NOTARY_KEYCHAIN) {
      credentials.keychain = process.env.APPLE_NOTARY_KEYCHAIN;
    }
    return credentials;
  }

  return {
    appleId: requiredEnv('APPLE_ID'),
    appleIdPassword: requiredEnv('APPLE_APP_SPECIFIC_PASSWORD'),
    teamId: requiredEnv('APPLE_TEAM_ID')
  };
}

function hasNotarizationCredentials() {
  return Boolean(
    process.env.APPLE_NOTARY_KEYCHAIN_PROFILE ||
    (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID)
  );
}

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  cleanupXattrs(appPath);

  if (!hasNotarizationCredentials()) return;

  await notarize({
    appBundleId: context.packager.appInfo.id,
    appPath,
    ...notarizationCredentials()
  });
};
