'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  computeCalibratedThreshold,
  minimumThresholdForCalibration,
  needsThresholdRepair,
  normalizeThresholdForCalibration,
  repairedThreshold
} = require('../renderer/mic-utils');

test('computeCalibratedThreshold raises threshold above the measured noise floor', () => {
  const result = computeCalibratedThreshold([0.08, 0.09, 0.1, 0.11]);

  assert.equal(result.noiseFloor, 0.095);
  assert.ok(result.threshold > result.noiseFloor);
});

test('needsThresholdRepair detects saved threshold below the calibrated noise floor', () => {
  const config = {
    micThreshold: 0.05,
    micCalibration: { noiseFloor: 0.096, peak: 1 }
  };

  assert.equal(needsThresholdRepair(config), true);
  assert.equal(repairedThreshold(config), 0.21);
});

test('normalizeThresholdForCalibration prevents manual thresholds below ambient noise', () => {
  const calibration = { noiseFloor: 0.077, peak: 0.375 };

  assert.equal(minimumThresholdForCalibration(calibration), 0.17);
  assert.equal(normalizeThresholdForCalibration(0.05, calibration), 0.17);
});

test('repairedThreshold keeps a deliberate threshold above the noise floor', () => {
  const config = {
    micThreshold: 0.18,
    micCalibration: { noiseFloor: 0.08, peak: 0.12 }
  };

  assert.equal(needsThresholdRepair(config), false);
  assert.equal(repairedThreshold(config), 0.18);
});
