const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFileName, detectDuplicates, DUPLICATE_TIERS } = require('../addon/DuplicateDetector.js');

test('normalizeFileName strips copy suffixes and numbering, keeps extension', () => {
  assert.equal(normalizeFileName('Report.pdf'), 'report.pdf');
  assert.equal(normalizeFileName('Report (1).pdf'), 'report.pdf');
  assert.equal(normalizeFileName('Report copy.pdf'), 'report.pdf');
  assert.equal(normalizeFileName('Report - Copy (2).pdf'), 'report.pdf');
  assert.equal(normalizeFileName('  Budget   2024.xlsx '), 'budget 2024.xlsx');
});

test('checksum match is a Confirmed duplicate regardless of name', () => {
  const files = [
    { id: '1', name: 'invoice-final.pdf', mimeType: 'application/pdf', size: 1000, md5Checksum: 'abc' },
    { id: '2', name: 'invoice-FINAL-v2.pdf', mimeType: 'application/pdf', size: 1000, md5Checksum: 'abc' },
    { id: '3', name: 'unrelated.pdf', mimeType: 'application/pdf', size: 1000, md5Checksum: 'zzz' }
  ];
  const groups = detectDuplicates(files);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].confidence, DUPLICATE_TIERS.CONFIRMED);
  assert.equal(groups[0].fileCount, 2);
});

test('same name + type + size without checksum is a Likely duplicate', () => {
  const files = [
    { id: '1', name: 'photo.jpg', mimeType: 'image/jpeg', size: 5000 },
    { id: '2', name: 'photo (1).jpg', mimeType: 'image/jpeg', size: 5000 }
  ];
  const groups = detectDuplicates(files);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].confidence, DUPLICATE_TIERS.LIKELY);
  assert.equal(groups[0].reclaimableBytes, 5000);
});

test('different sizes with the same name are NOT grouped as duplicates', () => {
  const files = [
    { id: '1', name: 'notes.txt', mimeType: 'text/plain', size: 100 },
    { id: '2', name: 'notes (1).txt', mimeType: 'text/plain', size: 9999 }
  ];
  assert.equal(detectDuplicates(files).length, 0);
});

test('Google-native docs with no size fall back to Possible duplicate', () => {
  const files = [
    { id: '1', name: 'Q3 Planning', mimeType: 'application/vnd.google-apps.document' },
    { id: '2', name: 'Q3 Planning (1)', mimeType: 'application/vnd.google-apps.document' }
  ];
  const groups = detectDuplicates(files);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].confidence, DUPLICATE_TIERS.POSSIBLE);
  assert.equal(groups[0].reclaimableUnknown, true);
});

test('a file is never claimed by more than one group', () => {
  const files = [
    { id: '1', name: 'a.pdf', mimeType: 'application/pdf', size: 10, md5Checksum: 'x' },
    { id: '2', name: 'a.pdf', mimeType: 'application/pdf', size: 10, md5Checksum: 'x' },
    { id: '3', name: 'a.pdf', mimeType: 'application/pdf', size: 10 }
  ];
  const groups = detectDuplicates(files);
  const seen = new Set();
  groups.forEach((g) => g.files.forEach((f) => {
    assert.equal(seen.has(f.id), false, `file ${f.id} claimed twice`);
    seen.add(f.id);
  }));
});

test('single unique files produce no groups', () => {
  const files = [{ id: '1', name: 'unique.pdf', mimeType: 'application/pdf', size: 10 }];
  assert.equal(detectDuplicates(files).length, 0);
});
