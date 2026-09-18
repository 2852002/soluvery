const test = require('node:test');
const assert = require('node:assert/strict');
const { formatBytes, emailDomain, categorizeMimeType, daysSince, truncate } = require('../addon/Utils.js');

test('formatBytes handles zero, bytes, KB, MB, GB', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5 MB');
  assert.equal(formatBytes(2.5 * 1024 * 1024 * 1024), '2.5 GB');
});

test('emailDomain extracts and lowercases the domain', () => {
  assert.equal(emailDomain('User@Example.COM'), 'example.com');
  assert.equal(emailDomain('no-at-sign'), '');
  assert.equal(emailDomain(''), '');
});

test('categorizeMimeType maps known types and falls back to Other', () => {
  assert.equal(categorizeMimeType('application/vnd.google-apps.document'), 'Google Docs');
  assert.equal(categorizeMimeType('application/pdf'), 'PDFs');
  assert.equal(categorizeMimeType('image/png'), 'Images');
  assert.equal(categorizeMimeType('video/mp4'), 'Videos');
  assert.equal(categorizeMimeType('application/x-totally-unknown'), 'Other');
});

test('daysSince computes whole days from an ISO date', () => {
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(daysSince(tenDaysAgo), 10);
  assert.equal(daysSince(null), null);
});

test('truncate shortens long strings and leaves short ones alone', () => {
  assert.equal(truncate('hello', 10), 'hello');
  assert.equal(truncate('a very long file name indeed', 10).length, 10);
});
