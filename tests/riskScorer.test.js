const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreFileRisk } = require('../addon/RiskScorer.js');

const OWNER_DOMAIN = 'mycompany.com';

test('a file shared with no one is Low risk with no reasons implying exposure', () => {
  const file = { name: 'notes.txt', modifiedTime: new Date().toISOString(), shared: false, permissions: [] };
  const result = scoreFileRisk(file, OWNER_DOMAIN);
  assert.equal(result.level, 'Low');
  assert.equal(result.score, 0);
});

test('publicly shared with edit access is High risk', () => {
  const file = {
    name: 'plan.docx',
    modifiedTime: new Date().toISOString(),
    shared: true,
    permissions: [{ type: 'anyone', role: 'writer' }]
  };
  const result = scoreFileRisk(file, OWNER_DOMAIN);
  assert.equal(result.level, 'High');
  assert.match(result.reasons[0], /Anyone with the link.*edit/);
});

test('publicly shared with view-only access is Medium, not High', () => {
  const file = {
    name: 'readme.txt',
    modifiedTime: new Date().toISOString(),
    shared: true,
    permissions: [{ type: 'anyone', role: 'reader' }]
  };
  const result = scoreFileRisk(file, OWNER_DOMAIN);
  assert.equal(result.level, 'Medium');
});

test('shared with external domains adds points capped at +4', () => {
  const file = {
    name: 'deck.pptx',
    modifiedTime: new Date().toISOString(),
    shared: true,
    permissions: [
      { type: 'user', role: 'reader', emailAddress: 'a@partner-one.com' },
      { type: 'user', role: 'reader', emailAddress: 'b@partner-two.com' },
      { type: 'user', role: 'reader', emailAddress: 'c@partner-three.com' }
    ]
  };
  const result = scoreFileRisk(file, OWNER_DOMAIN);
  assert.equal(result.score, 4); // capped even though 3 external domains
});

test('internal (same-domain) sharing does not count as external exposure', () => {
  const file = {
    name: 'team-notes.txt',
    modifiedTime: new Date().toISOString(),
    shared: true,
    permissions: [{ type: 'user', role: 'writer', emailAddress: 'colleague@mycompany.com' }]
  };
  const result = scoreFileRisk(file, OWNER_DOMAIN);
  assert.equal(result.level, 'Low');
});

test('sensitive file name only escalates risk when also shared', () => {
  const privateFile = { name: 'passwords.xlsx', modifiedTime: new Date().toISOString(), shared: false, permissions: [] };
  const sharedFile = {
    name: 'passwords.xlsx',
    modifiedTime: new Date().toISOString(),
    shared: true,
    permissions: [{ type: 'anyone', role: 'reader' }]
  };
  assert.equal(scoreFileRisk(privateFile, OWNER_DOMAIN).level, 'Low');
  const sharedResult = scoreFileRisk(sharedFile, OWNER_DOMAIN);
  assert.equal(sharedResult.score, 3 + 3); // anyone-reader (+3) + sensitive name (+3)
  assert.equal(sharedResult.level, 'High');
  assert.ok(sharedResult.reasons.some((r) => /sensitive/i.test(r)));
});

test('stale file that is still shared gets a small penalty', () => {
  const threeYearsAgo = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const file = {
    name: 'old-report.pdf',
    modifiedTime: threeYearsAgo,
    shared: true,
    permissions: [{ type: 'user', role: 'reader', emailAddress: 'x@mycompany.com' }]
  };
  const result = scoreFileRisk(file, OWNER_DOMAIN);
  assert.ok(result.reasons.some((r) => /2 years/.test(r)));
});
