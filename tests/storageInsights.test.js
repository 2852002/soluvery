const test = require('node:test');
const assert = require('node:assert/strict');
const { computeStorageInsights } = require('../addon/StorageInsights.js');

test('totals bytes, ignores folders, and counts unknown sizes separately', () => {
  const files = [
    { id: '1', name: 'a.pdf', mimeType: 'application/pdf', size: 1000 },
    { id: '2', name: 'b.pdf', mimeType: 'application/pdf', size: 2000 },
    { id: '3', name: 'Doc', mimeType: 'application/vnd.google-apps.document' }, // no size
    { id: '4', name: 'Folder', mimeType: 'application/vnd.google-apps.folder', size: 0 }
  ];
  const insights = computeStorageInsights(files);
  assert.equal(insights.totalBytes, 3000);
  assert.equal(insights.filesScanned, 4);
  assert.equal(insights.sizeUnknownCount, 1);
});

test('largest files are sorted descending and capped', () => {
  const files = Array.from({ length: 20 }, (_, i) => ({
    id: String(i), name: `f${i}.bin`, mimeType: 'application/octet-stream', size: i * 10
  }));
  const insights = computeStorageInsights(files);
  assert.ok(insights.largestFiles.length <= 15);
  assert.equal(insights.largestFiles[0].size, 190);
  for (let i = 1; i < insights.largestFiles.length; i++) {
    assert.ok(insights.largestFiles[i - 1].size >= insights.largestFiles[i].size);
  }
});

test('category breakdown percentages sum close to 100', () => {
  const files = [
    { id: '1', name: 'a.pdf', mimeType: 'application/pdf', size: 300 },
    { id: '2', name: 'b.png', mimeType: 'image/png', size: 700 }
  ];
  const insights = computeStorageInsights(files);
  const pctSum = insights.byCategory.reduce((s, c) => s + c.pct, 0);
  assert.ok(pctSum >= 99 && pctSum <= 100);
});
