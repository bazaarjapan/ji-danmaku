'use strict';

const { execFileSync } = require('child_process');

const target = process.argv[2] || 'all';

function missing(names) {
  return names.filter((name) => !process.env[name]);
}

function missingMacEnv() {
  const missingVars = missing(['CSC_NAME']);
  if (!process.env.APPLE_NOTARY_KEYCHAIN_PROFILE) {
    missingVars.push(...missing([
      'APPLE_ID',
      'APPLE_APP_SPECIFIC_PASSWORD',
      'APPLE_TEAM_ID'
    ]));
  }
  return missingVars;
}

const required = target === 'all'
  ? missingMacEnv()
  : target === 'mac'
    ? missingMacEnv()
    : [];

const missingVars = required;
if (missingVars.length) {
  console.error(`Release build is missing environment variables: ${missingVars.join(', ')}`);
  if (target === 'mac' || target === 'all') {
    console.error('mac release requires Apple Developer ID signing and notarization credentials.');
    console.error('Use APPLE_NOTARY_KEYCHAIN_PROFILE, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID.');
  }
  process.exit(1);
}

if ((target === 'mac' || target === 'all') && process.platform === 'darwin') {
  const identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8'
  });
  if (!identities.includes(process.env.CSC_NAME)) {
    console.error(`Release build cannot find signing identity in Keychain: ${process.env.CSC_NAME}`);
    console.error('Install the Developer ID Application certificate before running a macOS release build.');
    process.exit(1);
  }
}
