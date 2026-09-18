const test = require('node:test');
const assert = require('node:assert/strict');
const { computeHygieneScore } = require('../addon/HygieneScore.js');

test('a clean drive scores 100', () => {
  const result = computeHygieneScore({ Low: 10, Medium: 0, High: 0 }, 0, 100000);
  assert.equal(result.score, 100);
});

test('risky files reduce the score, capped at 50 points of penalty', () => {
  const result = computeHygieneScore({ Low: 0, Medium: 0, High: 100 }, 0, 100000);
  assert.equal(result.riskPenalty, 50);
  assert.equal(result.score, 50);
});

test('duplicate waste reduces the score, capped at 40 points of penalty', () => {
  const result = computeHygieneScore({ Low: 10, Medium: 0, High: 0 }, 100000, 100000); // 100% reclaimable
  assert.equal(result.duplicatePenalty, 40);
  assert.equal(result.score, 60);
});

test('score never goes below 0', () => {
  const result = computeHygieneScore({ Low: 0, Medium: 0, High: 999 }, 100000, 100000);
  assert.equal(result.score, 10); // 100 - 50 - 40
});

test('zero total bytes does not divide by zero', () => {
  const result = computeHygieneScore({ Low: 0, Medium: 0, High: 0 }, 0, 0);
  assert.equal(result.score, 100);
});
