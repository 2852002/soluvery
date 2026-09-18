/**
 * Cards.js  (Apps Script / CardService runtime only)
 *
 * All user-facing card builders. Nothing here ever prints a raw API object -
 * every value shown is formatted (bytes, dates) or explained in a sentence
 * (risk reasons, duplicate-group reasons) before it reaches the widget tree.
 */

function buildNavRow_(active) {
  var row = CardService.newButtonSet();
  var sections = [
    ['overview', 'Overview', 'showOverview'],
    ['duplicates', 'Duplicates', 'showDuplicates'],
    ['large', 'Large Files', 'showLargeFiles'],
    ['risky', 'Risky Files', 'showRiskyFiles']
  ];
  sections.forEach(function (s) {
    var btn = CardService.newTextButton()
      .setText(s[0] === active ? '● ' + s[1] : s[1])
      .setOnClickAction(CardService.newAction().setFunctionName(s[2]));
    row.addButton(btn);
  });
  return row;
}

function scanMetaSection_(summary) {
  var section = CardService.newCardSection();
  var scannedNote = 'Scanned ' + summary.filesScanned + ' file' + (summary.filesScanned === 1 ? '' : 's') +
    (summary.capReached ? ' (prototype cap: first ' + summary.scanCap + ', most recently modified)' : ' from My Drive') +
    ' on ' + new Date(summary.scannedAt).toLocaleString();
  section.addWidget(CardService.newTextParagraph().setText('<font color="#5f6368"><i>' + scannedNote + '</i></font>'));
  section.addWidget(CardService.newButtonSet().addButton(
    CardService.newTextButton().setText('Re-scan now').setOnClickAction(
      CardService.newAction().setFunctionName('rescan'))));
  return section;
}

function buildHomepageCard_() {
  if (isScanInProgress_()) {
    return buildScanInProgressCard_();
  }
  var summary = getLastSummary_();
  if (!summary) {
    return buildWelcomeCard_();
  }
  return buildOverviewCard_(summary);
}

function buildWelcomeCard_() {
  var card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle('Drive Hygiene Advisor'));
  var section = CardService.newCardSection();
  section.addWidget(CardService.newTextParagraph().setText(
    'Scans a sample of your My Drive files (up to ' + SCAN_CONFIG.MAX_FILES + ') for possible ' +
    'duplicates, large files, and risky sharing - using only file metadata, never file content.'));
  section.addWidget(CardService.newTextButton()
    .setText('Run analysis')
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(CardService.newAction().setFunctionName('rescan')));
  card.addSection(section);
  return card.build();
}

function buildScanInProgressCard_() {
  var card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle('Scanning your Drive…'));
  var section = CardService.newCardSection();
  section.addWidget(CardService.newTextParagraph().setText(
    'Processed ' + progressSoFar_() + ' files so far. This is continuing in the background ' +
    '(Apps Script has an execution time limit, so long scans checkpoint and resume automatically). ' +
    'Reopen the add-on in a moment and tap Refresh.'));
  section.addWidget(CardService.newTextButton()
    .setText('Refresh')
    .setOnClickAction(CardService.newAction().setFunctionName('showOverview')));
  card.addSection(section);
  return card.build();
}

function buildAuthRequiredCard_(authUrl) {
  var card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle('One more permission needed'));
  var section = CardService.newCardSection();
  section.addWidget(CardService.newTextParagraph().setText(
    'This add-on was updated and needs you to re-confirm its permissions before it can scan your Drive. ' +
    'Tap below, approve the request, then reopen the add-on.'));
  section.addWidget(CardService.newTextButton()
    .setText('Grant permission')
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOpenLink(CardService.newOpenLink().setUrl(authUrl)));
  card.addSection(section);
  return card.build();
}

function buildErrorCard_(err) {
  var card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle('Something went wrong'));
  var section = CardService.newCardSection();
  var message = (err && err.message) ? err.message : String(err);
  section.addWidget(CardService.newTextParagraph().setText(
    'The analysis could not complete: ' + truncate(message, 200)));
  section.addWidget(CardService.newTextButton()
    .setText('Try again')
    .setOnClickAction(CardService.newAction().setFunctionName('rescan')));
  card.addSection(section);
  return card.build();
}

function buildOverviewCard_(summary) {
  var card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle('Drive Hygiene Advisor').setSubtitle('Overview'));
  card.addSection(CardService.newCardSection().addWidget(buildNavRow_('overview')));

  var top = CardService.newCardSection();
  top.addWidget(CardService.newDecoratedText()
    .setTopLabel('Drive Hygiene Score')
    .setText('<b>' + summary.hygieneScore + ' / 100</b>')
    .setBottomLabel(hygieneScoreBlurb_(summary.hygieneScore)));

  top.addWidget(CardService.newDecoratedText()
    .setTopLabel('Risky files')
    .setText('<b>' + (summary.riskCounts.High + summary.riskCounts.Medium) + '</b>')
    .setBottomLabel(summary.riskCounts.High + ' high, ' + summary.riskCounts.Medium + ' medium, ' + summary.riskCounts.Low + ' low'));

  top.addWidget(CardService.newDecoratedText()
    .setTopLabel('Possible duplicate groups')
    .setText('<b>' + summary.duplicateGroups.length + '</b>')
    .setBottomLabel(summary.duplicateGroups.length ? formatBytes(summary.reclaimableBytes) + ' potentially reclaimable' : 'None found'));

  top.addWidget(CardService.newDecoratedText()
    .setTopLabel('Storage scanned')
    .setText('<b>' + formatBytes(summary.totalBytes) + '</b>')
    .setBottomLabel(summary.sizeUnknownCount + ' file(s) have no reported size (Google Docs/Sheets/Slides)'));

  card.addSection(top);
  card.addSection(scanMetaSection_(summary));
  return card.build();
}

function hygieneScoreBlurb_(score) {
  if (score >= 85) return 'Looking healthy.';
  if (score >= 60) return 'A few things worth a look.';
  return 'Several issues worth addressing.';
}

function buildDuplicatesCard_(summary) {
  var card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle('Drive Hygiene Advisor').setSubtitle('Duplicates'));
  card.addSection(CardService.newCardSection().addWidget(buildNavRow_('duplicates')));

  var section = CardService.newCardSection();
  if (!summary.duplicateGroups.length) {
    section.addWidget(CardService.newTextParagraph().setText('No likely duplicates found among the scanned files.'));
  } else {
    section.addWidget(CardService.newTextParagraph().setText(
      summary.duplicateGroups.length + ' group(s) found, ' + formatBytes(summary.reclaimableBytes) + ' potentially reclaimable.'));
    summary.duplicateGroups.slice(0, 25).forEach(function (g, idx) {
      section.addWidget(CardService.newDecoratedText()
        .setTopLabel(g.confidence)
        .setText(g.fileCount + ' files - "' + truncate(g.files[0].name, 40) + '" and similar')
        .setBottomLabel(g.reclaimableUnknown ? 'Size not verifiable' : formatBytes(g.reclaimableBytes) + ' reclaimable')
        .setOnClickAction(CardService.newAction().setFunctionName('showDuplicateGroupDetail').setParameters({ groupIndex: String(idx) })));
    });
  }
  card.addSection(section);
  card.addSection(scanMetaSection_(summary));
  return card.build();
}

function buildDuplicateGroupDetailCard_(summary, groupIndex) {
  var group = summary.duplicateGroups[groupIndex];
  var card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle(group.confidence).setSubtitle(group.fileCount + ' files'));

  var section = CardService.newCardSection();
  section.addWidget(CardService.newTextParagraph().setText(group.reason));
  if (group.files.length < group.fileCount) {
    section.addWidget(CardService.newTextParagraph().setText(
      '<i>Showing ' + group.files.length + ' of ' + group.fileCount + ' files in this group.</i>'));
  }
  group.files.forEach(function (f) {
    var widget = CardService.newDecoratedText()
      .setTopLabel(categorizeMimeType(f.mimeType))
      .setText(truncate(f.name, 50))
      .setBottomLabel(f.size !== undefined ? formatBytes(f.size) : 'Size unavailable');
    if (f.webViewLink) {
      widget.setButton(CardService.newTextButton().setText('Open').setOpenLink(CardService.newOpenLink().setUrl(f.webViewLink)));
    }
    section.addWidget(widget);
  });
  card.addSection(section);
  return card.build();
}

function buildLargeFilesCard_(summary) {
  var card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle('Drive Hygiene Advisor').setSubtitle('Large Files'));
  card.addSection(CardService.newCardSection().addWidget(buildNavRow_('large')));

  var breakdown = CardService.newCardSection().setHeader('Storage by type');
  summary.byCategory.slice(0, 8).forEach(function (c) {
    breakdown.addWidget(CardService.newDecoratedText()
      .setTopLabel(c.category)
      .setText(formatBytes(c.bytes) + ' (' + c.pct + '%)')
      .setBottomLabel(c.count + ' file(s)'));
  });
  card.addSection(breakdown);

  var section = CardService.newCardSection().setHeader('Largest files');
  if (!summary.largestFiles.length) {
    section.addWidget(CardService.newTextParagraph().setText('No sized files found in the scanned sample.'));
  } else {
    summary.largestFiles.forEach(function (f) {
      var widget = CardService.newDecoratedText()
        .setTopLabel(categorizeMimeType(f.mimeType) + ' · ' + formatRelativeAge(f.modifiedTime))
        .setText(truncate(f.name, 45))
        .setBottomLabel(formatBytes(f.size));
      if (f.webViewLink) {
        widget.setButton(CardService.newTextButton().setText('Open').setOpenLink(CardService.newOpenLink().setUrl(f.webViewLink)));
      }
      section.addWidget(widget);
    });
  }
  card.addSection(section);
  card.addSection(scanMetaSection_(summary));
  return card.build();
}

function buildRiskyFilesCard_(summary) {
  var card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle('Drive Hygiene Advisor').setSubtitle('Risky Files'));
  card.addSection(CardService.newCardSection().addWidget(buildNavRow_('risky')));

  var section = CardService.newCardSection();
  if (!summary.riskyFiles.length) {
    section.addWidget(CardService.newTextParagraph().setText('No Medium or High risk files found among the scanned files.'));
  } else {
    summary.riskyFiles.slice(0, 30).forEach(function (f, idx) {
      section.addWidget(CardService.newDecoratedText()
        .setTopLabel(riskEmoji_(f.level) + ' ' + f.level + ' risk')
        .setText(truncate(f.name, 45))
        .setBottomLabel(f.reasons[0])
        .setOnClickAction(CardService.newAction().setFunctionName('showRiskyFileDetail').setParameters({ fileIndex: String(idx) })));
    });
  }
  card.addSection(section);
  card.addSection(scanMetaSection_(summary));
  return card.build();
}

function riskEmoji_(level) {
  if (level === 'High') return '🔴';
  if (level === 'Medium') return '🟡';
  return '🟢';
}

function buildRiskyFileDetailCard_(summary, fileIndex) {
  var f = summary.riskyFiles[fileIndex];
  var card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle(f.level + ' risk').setSubtitle(truncate(f.name, 60)));

  var section = CardService.newCardSection().setHeader('Why this file was flagged');
  f.reasons.forEach(function (r) {
    section.addWidget(CardService.newTextParagraph().setText('• ' + r));
  });
  if (f.webViewLink) {
    section.addWidget(CardService.newTextButton().setText('Open in Drive').setOpenLink(CardService.newOpenLink().setUrl(f.webViewLink)));
  }
  card.addSection(section);
  return card.build();
}
