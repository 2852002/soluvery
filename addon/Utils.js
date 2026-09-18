/**
 * Utils.js
 * Small, dependency-free helper functions shared across the add-on.
 * Written so they also load under Node's test runner (see tests/).
 */

function formatBytes(bytes) {
  var n = Number(bytes);
  if (!isFinite(n) || n <= 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  var value = n / Math.pow(1024, i);
  var rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return rounded + ' ' + units[i];
}

function daysSince(isoDateString) {
  if (!isoDateString) return null;
  var then = new Date(isoDateString).getTime();
  if (isNaN(then)) return null;
  var now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

function formatRelativeAge(isoDateString) {
  var days = daysSince(isoDateString);
  if (days === null) return 'unknown';
  if (days < 1) return 'today';
  if (days < 30) return days + ' day' + (days === 1 ? '' : 's') + ' ago';
  if (days < 365) {
    var months = Math.round(days / 30);
    return months + ' month' + (months === 1 ? '' : 's') + ' ago';
  }
  var years = Math.round(days / 365 * 10) / 10;
  return years + ' year' + (years === 1 ? '' : 's') + ' ago';
}

/** Extracts the domain portion of an email address, lowercased. Returns '' if not derivable. */
function emailDomain(email) {
  if (!email || email.indexOf('@') === -1) return '';
  return email.split('@')[1].toLowerCase();
}

/** Maps a Drive mimeType to a coarse, human-friendly category used for storage breakdowns. */
function categorizeMimeType(mimeType) {
  if (!mimeType) return 'Other';
  var m = mimeType.toLowerCase();
  if (m === 'application/vnd.google-apps.folder') return 'Folders';
  if (m === 'application/vnd.google-apps.document') return 'Google Docs';
  if (m === 'application/vnd.google-apps.spreadsheet') return 'Google Sheets';
  if (m === 'application/vnd.google-apps.presentation') return 'Google Slides';
  if (m === 'application/vnd.google-apps.form') return 'Google Forms';
  if (m === 'application/pdf') return 'PDFs';
  if (m.indexOf('image/') === 0) return 'Images';
  if (m.indexOf('video/') === 0) return 'Videos';
  if (m.indexOf('audio/') === 0) return 'Audio';
  if (m.indexOf('zip') !== -1 || m.indexOf('compressed') !== -1 || m.indexOf('tar') !== -1) return 'Archives';
  if (m.indexOf('spreadsheet') !== -1 || m === 'text/csv') return 'Spreadsheets';
  if (m.indexOf('presentation') !== -1) return 'Presentations';
  if (m.indexOf('wordprocessingml') !== -1 || m === 'application/msword' || m.indexOf('text/') === 0) return 'Documents';
  return 'Other';
}

/** Truncates long strings for display in cards. */
function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 1) + '…';
}

if (typeof module !== 'undefined') {
  module.exports = {
    formatBytes: formatBytes,
    daysSince: daysSince,
    formatRelativeAge: formatRelativeAge,
    emailDomain: emailDomain,
    categorizeMimeType: categorizeMimeType,
    truncate: truncate
  };
}
