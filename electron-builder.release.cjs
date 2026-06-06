'use strict';

const packageJson = require('./package.json');

const build = JSON.parse(JSON.stringify(packageJson.build));

// Release builds must be signed. The development config keeps identity:null so
// unsigned local builds still work on machines without Apple Developer ID certs.
if (build.mac) {
  delete build.mac.identity;
  build.mac.hardenedRuntime = true;
  build.mac.gatekeeperAssess = false;
  build.mac.entitlements = 'build/entitlements.mac.plist';
  build.mac.entitlementsInherit = 'build/entitlements.mac.plist';
}

build.afterSign = 'scripts/after-sign.js';

module.exports = build;
