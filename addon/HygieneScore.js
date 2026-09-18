/**
 * HygieneScore.js
 *
 * A single 0-100 "Drive Hygiene Score" for the Overview card, deliberately
 * built from just two, easy-to-explain factors (documented in DECISIONS.md
 * #3) rather than a large opaque formula:
 *
 *   riskPenalty       = min(50, highRiskCount * 3 + mediumRiskCount * 1)
 *   duplicatePenalty  = min(40, round(reclaimableBytes / totalBytes * 100))
 *   score             = clamp(100 - riskPenalty - duplicatePenalty, 0, 100)
 */

function computeHygieneScore(riskCounts, reclaimableBytes, totalBytes) {
  var riskPenalty = Math.min(50, (riskCounts.High || 0) * 3 + (riskCounts.Medium || 0) * 1);
  var duplicatePct = totalBytes > 0 ? (reclaimableBytes / totalBytes) * 100 : 0;
  var duplicatePenalty = Math.min(40, Math.round(duplicatePct));
  var score = Math.max(0, Math.min(100, 100 - riskPenalty - duplicatePenalty));

  return {
    score: score,
    riskPenalty: riskPenalty,
    duplicatePenalty: duplicatePenalty
  };
}

if (typeof module !== 'undefined') {
  module.exports = { computeHygieneScore: computeHygieneScore };
}
