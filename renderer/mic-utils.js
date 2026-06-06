(function micUtilsFactory(root) {
  'use strict';

  function clampMicThreshold(value) {
    return Math.max(0.02, Math.min(0.4, value));
  }

  function computeCalibratedThreshold(samples) {
    const levels = (samples || []).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
    if (!levels.length) return { threshold: 0.12, noiseFloor: 0, peak: 0 };
    const sum = levels.reduce((acc, value) => acc + value, 0);
    const noiseFloor = sum / levels.length;
    const peak = levels[Math.min(levels.length - 1, Math.floor(levels.length * 0.95))] || 0;
    const threshold = clampMicThreshold(Math.max(0.04, noiseFloor * 2.8, peak * 1.7));
    return {
      threshold: Number(threshold.toFixed(2)),
      noiseFloor: Number(noiseFloor.toFixed(3)),
      peak: Number(peak.toFixed(3))
    };
  }

  function minimumThresholdForCalibration(calibration) {
    const noiseFloor = Number(calibration && calibration.noiseFloor) || 0;
    if (noiseFloor <= 0) return 0.02;
    return Number(clampMicThreshold(Math.max(0.08, noiseFloor * 2.2)).toFixed(2));
  }

  function normalizeThresholdForCalibration(value, calibration) {
    const current = Number(value);
    const threshold = clampMicThreshold(Number.isFinite(current) && current > 0 ? current : 0.12);
    return Number(Math.max(threshold, minimumThresholdForCalibration(calibration)).toFixed(2));
  }

  function repairedThreshold(config) {
    const cfg = config || {};
    return normalizeThresholdForCalibration(cfg.micThreshold, cfg.micCalibration || {});
  }

  function needsThresholdRepair(config) {
    const cfg = config || {};
    return repairedThreshold(cfg) > (Number(cfg.micThreshold) || 0.12);
  }

  const api = {
    clampMicThreshold,
    computeCalibratedThreshold,
    minimumThresholdForCalibration,
    needsThresholdRepair,
    normalizeThresholdForCalibration,
    repairedThreshold
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JiMicUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
