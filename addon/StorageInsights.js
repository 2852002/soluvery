/**
 * StorageInsights.js
 *
 * Aggregates a batch of files into: total bytes, the largest N files, and a
 * breakdown by coarse category. Google-native files (Docs/Sheets/Slides,
 * Forms) frequently report no `size` from the Drive API since they are not
 * stored as a single blob - those are counted and shown separately rather
 * than silently treated as 0 bytes, so the totals aren't misleading.
 *
 * This is the "batch" reference implementation of the aggregation rules -
 * it's what's unit tested below, and what a small, one-shot scan (e.g. the
 * contextual single-file check) could call directly. The full homepage scan
 * in DriveScanner.js applies the same rules incrementally, page by page
 * (foldPage_), so it never has to hold every scanned file in memory at once
 * - see DECISIONS.md #4.
 */

var TOP_LARGE_FILES_LIMIT = 15;

var categorizeMimeType_ref;
if (typeof module !== 'undefined') {
  categorizeMimeType_ref = require('./Utils.js').categorizeMimeType;
} else {
  categorizeMimeType_ref = categorizeMimeType;
}

function computeStorageInsights(files) {
  var totalBytes = 0;
  var sizeUnknownCount = 0;
  var categoryMap = {};
  var sizedFiles = [];

  files.forEach(function (f) {
    if (f.mimeType === 'application/vnd.google-apps.folder') return;

    var hasSize = f.size !== undefined && f.size !== null && f.size !== '';
    var bytes = hasSize ? Number(f.size) : 0;
    if (!hasSize) sizeUnknownCount++;
    totalBytes += bytes;

    var category = categorizeMimeType_ref(f.mimeType);
    if (!categoryMap[category]) categoryMap[category] = { category: category, bytes: 0, count: 0 };
    categoryMap[category].bytes += bytes;
    categoryMap[category].count += 1;

    if (hasSize) sizedFiles.push(f);
  });

  var byCategory = Object.keys(categoryMap).map(function (k) { return categoryMap[k]; });
  byCategory.forEach(function (c) {
    c.pct = totalBytes > 0 ? Math.round((c.bytes / totalBytes) * 100) : 0;
  });
  byCategory.sort(function (a, b) { return b.bytes - a.bytes; });

  var largestFiles = sizedFiles
    .slice()
    .sort(function (a, b) { return Number(b.size) - Number(a.size); })
    .slice(0, TOP_LARGE_FILES_LIMIT);

  return {
    totalBytes: totalBytes,
    filesScanned: files.length,
    sizeUnknownCount: sizeUnknownCount,
    byCategory: byCategory,
    largestFiles: largestFiles
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    computeStorageInsights: computeStorageInsights,
    TOP_LARGE_FILES_LIMIT: TOP_LARGE_FILES_LIMIT
  };
}
