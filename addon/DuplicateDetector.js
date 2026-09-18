/**
 * DuplicateDetector.js
 *
 * Duplicate-detection rules (documented in DECISIONS.md #1):
 *
 *  Tier 1 - CONFIRMED  : two or more files share an identical md5Checksum.
 *                        Checksums only exist for files with actual binary
 *                        content (uploads, PDFs, images, etc.) - Google-native
 *                        Docs/Sheets/Slides never have one. A checksum match
 *                        means the bytes are provably identical.
 *
 *  Tier 2 - LIKELY      : no checksum available on at least one side, but the
 *                        files have the same normalized name, the same
 *                        mimeType, and the same exact size.
 *
 *  Tier 3 - POSSIBLE    : same normalized name and mimeType, but size is
 *                        missing on at least one side (common for
 *                        Google-native files) so it cannot be verified.
 *
 * A file is only ever placed in the highest tier it qualifies for, so groups
 * never overlap and a file cannot be "double counted" as reclaimable space
 * in more than one group.
 */

var DUPLICATE_TIERS = {
  CONFIRMED: 'Confirmed duplicate',
  LIKELY: 'Likely duplicate',
  POSSIBLE: 'Possible duplicate'
};

var COPY_SUFFIX_RE = /[\s_-]*\(\d+\)\s*$/;
var COPY_WORD_RE = /[\s_-]*copy(\s*\d+)?\s*$/i;

function normalizeFileName(rawName) {
  if (!rawName) return '';
  var name = String(rawName).trim().toLowerCase().replace(/\s+/g, ' ');

  var ext = '';
  var dot = name.lastIndexOf('.');
  if (dot > 0 && name.length - dot <= 6) {
    ext = name.substring(dot);
    name = name.substring(0, dot);
  }

  name = name.replace(COPY_SUFFIX_RE, '');
  name = name.replace(COPY_WORD_RE, '');

  return (name.trim() + ext).trim();
}

function detectDuplicates(files) {
  var claimed = {};
  var groups = [];

  groups = groups.concat(groupByChecksum_(files, claimed));
  groups = groups.concat(groupByNameAndSize_(files, claimed, true));
  groups = groups.concat(groupByNameAndSize_(files, claimed, false));

  groups.sort(function (a, b) {
    return b.reclaimableBytes - a.reclaimableBytes;
  });

  return groups;
}

function groupByChecksum_(files, claimed) {
  var byKey = {};
  files.forEach(function (f) {
    if (!f.md5Checksum || claimed[f.id]) return;
    var key = f.md5Checksum + ':' + (f.size || 0);
    (byKey[key] = byKey[key] || []).push(f);
  });

  var groups = [];
  Object.keys(byKey).forEach(function (key) {
    var members = byKey[key];
    if (members.length < 2) return;
    members.forEach(function (f) { claimed[f.id] = true; });
    groups.push(buildGroup_(members, DUPLICATE_TIERS.CONFIRMED,
      'These files have byte-for-byte identical content (matching checksum and size).'));
  });
  return groups;
}

function groupByNameAndSize_(files, claimed, requireSize) {
  var byKey = {};
  files.forEach(function (f) {
    if (claimed[f.id]) return;
    var norm = normalizeFileName(f.name);
    if (!norm) return;
    var hasSize = f.size !== undefined && f.size !== null && f.size !== '';
    if (requireSize && !hasSize) return;
    if (!requireSize && hasSize) return; // handled by the requireSize pass
    var sizeKey = requireSize ? f.size : 'nosize';
    var key = norm + '|' + f.mimeType + '|' + sizeKey;
    (byKey[key] = byKey[key] || []).push(f);
  });

  var groups = [];
  Object.keys(byKey).forEach(function (key) {
    var members = byKey[key];
    if (members.length < 2) return;
    members.forEach(function (f) { claimed[f.id] = true; });
    var tier = requireSize ? DUPLICATE_TIERS.LIKELY : DUPLICATE_TIERS.POSSIBLE;
    var reason = requireSize
      ? 'These files share a similar name, the same file type, and the exact same size.'
      : 'These files share a similar name and file type, but size could not be compared (common for Google Docs/Sheets/Slides).';
    groups.push(buildGroup_(members, tier, reason));
  });
  return groups;
}

function buildGroup_(members, tier, reason) {
  var sizes = members.map(function (f) { return Number(f.size) || 0; });
  var totalBytes = sizes.reduce(function (a, b) { return a + b; }, 0);
  var maxBytes = Math.max.apply(null, sizes);
  var sizeKnown = members.every(function (f) { return f.size !== undefined && f.size !== null && f.size !== ''; });

  return {
    key: members.map(function (f) { return f.id; }).sort().join(','),
    confidence: tier,
    reason: reason,
    fileCount: members.length,
    reclaimableBytes: sizeKnown ? (totalBytes - maxBytes) : 0,
    reclaimableUnknown: !sizeKnown,
    files: members
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    DUPLICATE_TIERS: DUPLICATE_TIERS,
    normalizeFileName: normalizeFileName,
    detectDuplicates: detectDuplicates
  };
}
