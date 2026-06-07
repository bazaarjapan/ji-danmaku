'use strict';

const { cleanupXattrs } = require('./mac-xattrs');

module.exports = async function afterExtract(context) {
  if (context.electronPlatformName !== 'darwin') return;
  cleanupXattrs(context.appOutDir);
};
