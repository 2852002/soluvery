/**
 * DriveScanner.js  (Apps Script runtime only - not unit tested under Node,
 * since it calls Drive/PropertiesService/ScriptApp/Session directly)
 *
 * Orchestrates a My Drive scan:
 *  - Paginates the Drive API (never asks for "everything at once").
 *  - Folds each page into a small, BOUNDED accumulator (running sums, a
 *    capped top-N large-files list, a capped risky-files list) instead of
 *    keeping every raw API response in memory - see DECISIONS.md #4.
 *  - Retries transient/quota errors with exponential backoff.
 *  - If a scan runs long enough to risk Apps Script's ~6 minute execution
 *    limit, it checkpoints progress to PropertiesService and schedules a
 *    one-off trigger to resume, rather than losing partial work.
 *
 * Duplicate detection needs to compare files across the *whole* scan, so we
 * also retain one small record per file (id/name/mimeType/size/checksum) -
 * bounded by SCAN_CONFIG.MAX_FILES, which is the explicit prototype cap.
 * At real (millions-of-files) scale this bounded in-memory list is exactly
 * the piece that would move to an external index/database - see the
 * "Scaling beyond this prototype" section of README.md.
 */

var SCAN_CONFIG = {
  MAX_FILES: 300,          // explicit sample cap for this prototype - shown in the UI, never hidden
  PAGE_SIZE: 100,
  MAX_RISKY_FILES_KEPT: 50,
  EXECUTION_SAFETY_MS: 4.5 * 60 * 1000
};

var FILE_FIELDS = 'nextPageToken, files(id,name,mimeType,size,md5Checksum,modifiedTime,webViewLink,shared,permissions(type,role,emailAddress,domain))';

var PROP_CHECKPOINT = 'SCAN_CHECKPOINT_V1';

// PropertiesService caps a single value at ~9KB. Rather than guess fixed
// array lengths that "should" fit, each large section of the summary is
// stored under its own key and self-shrinks until it actually fits - see
// persistSummary_()/getLastSummary_() and DECISIONS.md #4.
var PROP_META = 'HYGIENE_META_V1';
var PROP_LARGE = 'HYGIENE_LARGE_V1';
var PROP_RISKY = 'HYGIENE_RISKY_V1';
var PROP_DUPES = 'HYGIENE_DUPES_V1';
var MAX_PROPERTY_CHARS = 8500; // stay comfortably under the ~9216 char/byte limit

function getUserDomain_() {
  var email = Session.getActiveUser().getEmail();
  return emailDomain(email);
}

function newAccumulator_() {
  return {
    filesProcessed: 0,
    totalBytes: 0,
    sizeUnknownCount: 0,
    categoryMap: {},
    largestFiles: [],
    riskCounts: { Low: 0, Medium: 0, High: 0 },
    riskyFiles: [],
    fileRecords: []
  };
}

function foldPage_(acc, files, ownerDomain) {
  files.forEach(function (f) {
    if (f.mimeType === 'application/vnd.google-apps.folder') return;
    acc.filesProcessed++;

    var hasSize = f.size !== undefined && f.size !== null && f.size !== '';
    var bytes = hasSize ? Number(f.size) : 0;
    if (!hasSize) acc.sizeUnknownCount++;
    acc.totalBytes += bytes;

    var category = categorizeMimeType(f.mimeType);
    if (!acc.categoryMap[category]) acc.categoryMap[category] = { category: category, bytes: 0, count: 0 };
    acc.categoryMap[category].bytes += bytes;
    acc.categoryMap[category].count += 1;

    if (hasSize) {
      acc.largestFiles.push({
        id: f.id, name: f.name, size: bytes, mimeType: f.mimeType,
        webViewLink: f.webViewLink, modifiedTime: f.modifiedTime
      });
      acc.largestFiles.sort(function (a, b) { return b.size - a.size; });
      if (acc.largestFiles.length > TOP_LARGE_FILES_LIMIT) acc.largestFiles.length = TOP_LARGE_FILES_LIMIT;
    }

    var risk = scoreFileRisk(f, ownerDomain);
    acc.riskCounts[risk.level] = (acc.riskCounts[risk.level] || 0) + 1;
    if (risk.level !== 'Low') {
      acc.riskyFiles.push({
        id: f.id, name: f.name, mimeType: f.mimeType, webViewLink: f.webViewLink,
        modifiedTime: f.modifiedTime, level: risk.level, score: risk.score, reasons: risk.reasons
      });
      acc.riskyFiles.sort(function (a, b) { return b.score - a.score; });
      if (acc.riskyFiles.length > SCAN_CONFIG.MAX_RISKY_FILES_KEPT) acc.riskyFiles.length = SCAN_CONFIG.MAX_RISKY_FILES_KEPT;
    }

    acc.fileRecords.push({
      id: f.id, name: f.name, mimeType: f.mimeType,
      size: hasSize ? bytes : undefined, md5Checksum: f.md5Checksum, webViewLink: f.webViewLink
    });
  });
  return acc;
}

function finalizeAnalysis_(acc) {
  var duplicateGroups = detectDuplicates(acc.fileRecords);
  var reclaimableBytes = duplicateGroups.reduce(function (sum, g) { return sum + (g.reclaimableBytes || 0); }, 0);
  var hygiene = computeHygieneScore(acc.riskCounts, reclaimableBytes, acc.totalBytes);

  var byCategory = Object.keys(acc.categoryMap).map(function (k) { return acc.categoryMap[k]; });
  byCategory.forEach(function (c) { c.pct = acc.totalBytes > 0 ? Math.round((c.bytes / acc.totalBytes) * 100) : 0; });
  byCategory.sort(function (a, b) { return b.bytes - a.bytes; });

  return {
    scannedAt: new Date().toISOString(),
    filesScanned: acc.filesProcessed,
    scanCap: SCAN_CONFIG.MAX_FILES,
    capReached: acc.filesProcessed >= SCAN_CONFIG.MAX_FILES,
    totalBytes: acc.totalBytes,
    sizeUnknownCount: acc.sizeUnknownCount,
    byCategory: byCategory,
    largestFiles: acc.largestFiles,
    riskCounts: acc.riskCounts,
    riskyFiles: acc.riskyFiles,
    duplicateGroups: duplicateGroups,
    reclaimableBytes: reclaimableBytes,
    hygieneScore: hygiene.score
  };
}

function runAnalysis(resume) {
  var props = PropertiesService.getUserProperties();
  var startTime = Date.now();
  var ownerDomain = getUserDomain_();

  var acc, pageToken;
  if (resume) {
    var checkpointRaw = props.getProperty(PROP_CHECKPOINT);
    if (!checkpointRaw) return runAnalysis(false);
    var checkpoint = JSON.parse(checkpointRaw);
    acc = checkpoint.acc;
    pageToken = checkpoint.pageToken;
  } else {
    acc = newAccumulator_();
    pageToken = null;
    props.deleteProperty(PROP_CHECKPOINT);
  }

  while (acc.filesProcessed < SCAN_CONFIG.MAX_FILES) {
    var remaining = SCAN_CONFIG.MAX_FILES - acc.filesProcessed;
    var pageSize = Math.min(SCAN_CONFIG.PAGE_SIZE, remaining);

    var response = fetchFilesPage_(pageToken, pageSize);
    foldPage_(acc, response.files || [], ownerDomain);
    pageToken = response.nextPageToken;

    if (!pageToken) break;

    if (Date.now() - startTime > SCAN_CONFIG.EXECUTION_SAFETY_MS) {
      saveCheckpoint_(props, acc, pageToken);
      scheduleContinuation_();
      return { inProgress: true, filesProcessedSoFar: acc.filesProcessed };
    }
  }

  props.deleteProperty(PROP_CHECKPOINT);
  var result = finalizeAnalysis_(acc);
  persistSummary_(props, result);
  return result;
}

/**
 * Persists the summary across a few PropertiesService keys instead of one,
 * and shrinks each large section (halving it, or thinning duplicate-group
 * file lists first) until it actually fits that key's ~9KB limit. Returns
 * nothing - `result` is mutated in place so the in-memory copy the caller
 * renders matches exactly what was persisted (no surprise on next reload).
 */
function persistSummary_(props, result) {
  result.largestFiles = setJsonPropertyBounded_(props, PROP_LARGE, result.largestFiles, function (arr) {
    return arr.slice(0, Math.max(1, Math.floor(arr.length / 2)));
  });
  result.riskyFiles = setJsonPropertyBounded_(props, PROP_RISKY, result.riskyFiles, function (arr) {
    return arr.slice(0, Math.max(1, Math.floor(arr.length / 2)));
  });
  result.duplicateGroups = setJsonPropertyBounded_(props, PROP_DUPES, result.duplicateGroups, function (groups) {
    var canThinFiles = groups.some(function (g) { return g.files.length > 3; });
    if (canThinFiles) {
      return groups.map(function (g) {
        var keep = Math.max(3, Math.ceil(g.files.length / 2));
        return Object.assign({}, g, { files: g.files.slice(0, keep) });
      });
    }
    return groups.slice(0, Math.max(1, Math.floor(groups.length / 2)));
  });

  var meta = {};
  Object.keys(result).forEach(function (k) {
    if (k !== 'largestFiles' && k !== 'riskyFiles' && k !== 'duplicateGroups') meta[k] = result[k];
  });
  props.setProperty(PROP_META, JSON.stringify(meta));
}

function setJsonPropertyBounded_(props, key, value, shrinkFn) {
  var json = JSON.stringify(value);
  var attempts = 0;
  while (json.length > MAX_PROPERTY_CHARS && attempts < 8 && value.length > 0) {
    value = shrinkFn(value);
    json = JSON.stringify(value);
    attempts++;
  }
  props.setProperty(key, json);
  return value;
}

/**
 * A checkpoint's `acc.fileRecords` grows with every file processed and is by
 * far its largest part. In the rare case a scan runs long enough to reach a
 * checkpoint AND that checkpoint doesn't fit PropertiesService's ~9KB limit,
 * we drop fileRecords rather than fail the whole scan - resuming just means
 * a few duplicate matches across the pre/post-checkpoint boundary might be
 * missed, which is a reasonable trade-off against losing all progress.
 */
function saveCheckpoint_(props, acc, pageToken) {
  var payload = JSON.stringify({ acc: acc, pageToken: pageToken });
  if (payload.length > MAX_PROPERTY_CHARS) {
    var trimmedAcc = Object.assign({}, acc, { fileRecords: [] });
    payload = JSON.stringify({ acc: trimmedAcc, pageToken: pageToken });
  }
  props.setProperty(PROP_CHECKPOINT, payload);
}

function fetchFilesPage_(pageToken, pageSize) {
  var attempt = 0;
  while (true) {
    try {
      return Drive.Files.list({
        q: "'me' in owners and trashed = false",
        orderBy: 'modifiedTime desc',
        pageSize: pageSize,
        pageToken: pageToken || null,
        fields: FILE_FIELDS,
        supportsAllDrives: false
      });
    } catch (err) {
      attempt++;
      if (attempt > 3 || !isRetryable_(err)) throw err;
      Utilities.sleep(Math.pow(2, attempt) * 500);
    }
  }
}

function isRetryable_(err) {
  var msg = (err && err.message) || String(err);
  return /rate limit|quota|backend|internal|503|500|429/i.test(msg);
}

function scheduleContinuation_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'continueScan') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('continueScan').timeBased().after(5000).create();
}

function continueScan() {
  runAnalysis(true);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'continueScan') ScriptApp.deleteTrigger(t);
  });
}

function getLastSummary_() {
  var props = PropertiesService.getUserProperties();
  var metaRaw = props.getProperty(PROP_META);
  if (!metaRaw) return null;

  var summary = JSON.parse(metaRaw);
  summary.largestFiles = JSON.parse(props.getProperty(PROP_LARGE) || '[]');
  summary.riskyFiles = JSON.parse(props.getProperty(PROP_RISKY) || '[]');
  summary.duplicateGroups = JSON.parse(props.getProperty(PROP_DUPES) || '[]');
  return summary;
}

function isScanInProgress_() {
  return !!PropertiesService.getUserProperties().getProperty(PROP_CHECKPOINT);
}

function progressSoFar_() {
  var raw = PropertiesService.getUserProperties().getProperty(PROP_CHECKPOINT);
  if (!raw) return 0;
  return JSON.parse(raw).acc.filesProcessed;
}
