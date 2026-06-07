'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ji-reaction-mac-build-'));

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function copyArtifacts() {
  fs.mkdirSync(distDir, { recursive: true });
  for (const file of fs.readdirSync(tempDir)) {
    if (
      /^Ji-Reaction-.+-arm64\.dmg(\.blockmap)?$/.test(file) ||
      /^Ji-Reaction-.+-arm64-mac\.zip(\.blockmap)?$/.test(file) ||
      file === 'latest-mac.yml'
    ) {
      fs.copyFileSync(path.join(tempDir, file), path.join(distDir, file));
    }
  }
}

try {
  run('npx', [
    'electron-builder',
    '--mac',
    '--publish',
    'never',
    `-c.directories.output=${tempDir}`
  ]);
  copyArtifacts();
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
