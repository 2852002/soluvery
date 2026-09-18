/**
 * RiskScorer.js
 *
 * Risk scoring rules (documented in DECISIONS.md #2). We only ever look at
 * *sharing/access metadata* returned by the Drive API - never file content -
 * because the add-on requests a metadata-only OAuth scope.
 *
 * Point weights (each fired rule is shown to the user as a plain-English
 * reason, never as raw JSON). Public ("Anyone with the link") edit access is
 * severe enough to be High risk on its own; public view access and
 * organization-wide edit access are severe enough to be Medium on their own:
 *   +6  Shared publicly ("Anyone with the link") with edit access
 *   +4  Shared publicly ("Anyone with the link") with comment access
 *   +3  Shared publicly ("Anyone with the link") with view access
 *   +3  Shared with the whole organization/domain with edit access
 *   +2  Shared with the whole organization/domain with view access
 *   +2  Shared with each external (outside-domain) individual, capped at +4
 *   +3  File name suggests sensitive content AND it is shared beyond just the owner
 *   +1  Not modified in 2+ years but still shared with someone
 *   +2  Marked as shared by the API but no permission details were returned
 *
 * Score -> level:  0-2 Low, 3-5 Medium, 6+ High.
 * A file that is not shared with anyone always scores 0 (Low) regardless of
 * its name, because without content access we cannot confirm sensitivity -
 * risk here means "exposure", not "guessed content".
 */

var SENSITIVE_NAME_RE = new RegExp(
  '\\b(password|passwords|confidential|secret|ssn|social[ _-]?security|' +
  'salary|salaries|payroll|contract|invoice|tax|credential|credentials|' +
  'backup|private|bank|routing[ _-]?number)\\b',
  'i'
);

var STALE_DAYS_THRESHOLD = 730; // ~2 years

// emailDomain/daysSince live in Utils.js; in the Apps Script runtime all
// files share one global scope so these resolve automatically. Under Node
// (tests) we pull them in explicitly below.
var emailDomain, daysSince;
if (typeof module !== 'undefined') {
  var _utils = require('./Utils.js');
  emailDomain = _utils.emailDomain;
  daysSince = _utils.daysSince;
}

function scoreFileRisk(file, ownerDomain) {
  var reasons = [];
  var score = 0;
  var permissions = file.permissions || [];

  var anyone = permissions.filter(function (p) { return p.type === 'anyone'; });
  if (anyone.length) {
    var best = bestRole_(anyone);
    if (best === 'writer' || best === 'owner') {
      score += 6;
      reasons.push('Shared publicly via "Anyone with the link" with edit access.');
    } else if (best === 'commenter') {
      score += 4;
      reasons.push('Shared publicly via "Anyone with the link" with comment access.');
    } else {
      score += 3;
      reasons.push('Shared publicly via "Anyone with the link" with view access.');
    }
  }

  var domainShares = permissions.filter(function (p) { return p.type === 'domain'; });
  if (domainShares.length) {
    var bestDomainRole = bestRole_(domainShares);
    if (bestDomainRole === 'writer' || bestDomainRole === 'owner') {
      score += 3;
      reasons.push('Shared with your entire organization with edit access.');
    } else {
      score += 2;
      reasons.push('Shared with your entire organization with view access.');
    }
  }

  var externalDomains = {};
  permissions.forEach(function (p) {
    if (p.type !== 'user' || !p.emailAddress) return;
    var domain = emailDomain(p.emailAddress);
    if (domain && ownerDomain && domain !== ownerDomain) {
      externalDomains[domain] = true;
    }
  });
  var externalDomainCount = Object.keys(externalDomains).length;
  if (externalDomainCount > 0) {
    score += Math.min(4, externalDomainCount * 2);
    reasons.push('Shared with ' + externalDomainCount + ' external domain' +
      (externalDomainCount === 1 ? '' : 's') + ' outside your organization (' +
      Object.keys(externalDomains).slice(0, 3).join(', ') + ').');
  }

  var sharedWithAnyone = anyone.length > 0 || domainShares.length > 0 || externalDomainCount > 0;
  if (SENSITIVE_NAME_RE.test(file.name || '') && sharedWithAnyone) {
    score += 3;
    reasons.push('File name suggests sensitive content, and the file is shared beyond just you.');
  }

  var days = daysSince(file.modifiedTime);
  if (days !== null && days >= STALE_DAYS_THRESHOLD && file.shared) {
    score += 1;
    reasons.push('Not modified in over 2 years, but still shared with others.');
  }

  if (file.shared && permissions.length === 0) {
    score += 2;
    reasons.push('Marked as shared, but detailed permission info was not returned by the API.');
  }

  var level = score >= 6 ? 'High' : (score >= 3 ? 'Medium' : 'Low');
  if (reasons.length === 0) {
    reasons.push('Not shared beyond you; no elevated exposure detected.');
  }

  return { level: level, score: score, reasons: reasons };
}

function bestRole_(perms) {
  var order = ['owner', 'writer', 'commenter', 'reader'];
  var best = 'reader';
  var bestIndex = order.length;
  perms.forEach(function (p) {
    var idx = order.indexOf(p.role);
    if (idx !== -1 && idx < bestIndex) {
      bestIndex = idx;
      best = p.role;
    }
  });
  return best;
}

if (typeof module !== 'undefined') {
  module.exports = {
    scoreFileRisk: scoreFileRisk,
    SENSITIVE_NAME_RE: SENSITIVE_NAME_RE,
    STALE_DAYS_THRESHOLD: STALE_DAYS_THRESHOLD
  };
}
