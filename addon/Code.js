/**
 * Code.js  (Apps Script entry points)
 *
 * Registered in appsscript.json as the add-on's homepage and navigation
 * handlers. Every handler is wrapped so a Drive API/quota failure renders a
 * friendly error card instead of a blank/broken add-on.
 */

/**
 * Checks whether every scope the manifest currently declares has actually
 * been granted (not just whatever was granted at install time - a later
 * push that adds a scope leaves existing installs under-authorized until
 * the user re-grants). If not, returns a card with a direct "Grant
 * permission" link instead of letting a raw authorization exception surface
 * from deep inside a Drive/Session call.
 */
function authRequiredCard_() {
  var authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
  if (authInfo.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
    return buildAuthRequiredCard_(authInfo.getAuthorizationUrl());
  }
  return null;
}

function onHomepage(e) {
  var authCard = authRequiredCard_();
  if (authCard) return authCard;
  try {
    return buildHomepageCard_();
  } catch (err) {
    return buildErrorCard_(err);
  }
}

/** Optional bonus: contextual card when the user selects file(s) in Drive. */
function onDriveItemsSelected(e) {
  var authCard = authRequiredCard_();
  if (authCard) return authCard;
  try {
    var items = (e && e.drive && e.drive.selectedItems) || [];
    if (!items.length) return buildHomepageCard_();

    var ownerDomain = getUserDomain_();
    var file = Drive.Files.get(items[0].id, {
      fields: 'id,name,mimeType,size,modifiedTime,webViewLink,shared,permissions(type,role,emailAddress,domain)'
    });
    var risk = scoreFileRisk(file, ownerDomain);

    var card = CardService.newCardBuilder();
    card.setHeader(CardService.newCardHeader().setTitle('Drive Hygiene Advisor').setSubtitle(truncate(file.name, 50)));
    var section = CardService.newCardSection().setHeader(riskEmoji_(risk.level) + ' ' + risk.level + ' risk');
    risk.reasons.forEach(function (r) { section.addWidget(CardService.newTextParagraph().setText('• ' + r)); });
    section.addWidget(CardService.newDecoratedText().setTopLabel('Size').setText(file.size ? formatBytes(file.size) : 'N/A (Google-native file)'));
    card.addSection(section);
    return card.build();
  } catch (err) {
    return buildErrorCard_(err);
  }
}

function rescan() {
  var authCard = authRequiredCard_();
  if (authCard) return navUpdate_(authCard);
  try {
    var result = runAnalysis(false);
    if (result && result.inProgress) return navUpdate_(buildScanInProgressCard_());
    return navUpdate_(buildOverviewCard_(result));
  } catch (err) {
    return navUpdate_(buildErrorCard_(err));
  }
}

function showOverview() {
  return withSummary_(function (summary) { return buildOverviewCard_(summary); });
}

function showDuplicates() {
  return withSummary_(function (summary) { return buildDuplicatesCard_(summary); });
}

function showLargeFiles() {
  return withSummary_(function (summary) { return buildLargeFilesCard_(summary); });
}

function showRiskyFiles() {
  return withSummary_(function (summary) { return buildRiskyFilesCard_(summary); });
}

function showDuplicateGroupDetail(e) {
  try {
    var summary = getLastSummary_();
    if (!summary) return navPush_(buildWelcomeCard_());
    var idx = Number(e.parameters.groupIndex);
    return navPush_(buildDuplicateGroupDetailCard_(summary, idx));
  } catch (err) {
    return navPush_(buildErrorCard_(err));
  }
}

function showRiskyFileDetail(e) {
  try {
    var summary = getLastSummary_();
    if (!summary) return navPush_(buildWelcomeCard_());
    var idx = Number(e.parameters.fileIndex);
    return navPush_(buildRiskyFileDetailCard_(summary, idx));
  } catch (err) {
    return navPush_(buildErrorCard_(err));
  }
}

function withSummary_(renderFn) {
  var authCard = authRequiredCard_();
  if (authCard) return navUpdate_(authCard);
  try {
    if (isScanInProgress_()) return navUpdate_(buildScanInProgressCard_());
    var summary = getLastSummary_();
    if (!summary) return navUpdate_(buildWelcomeCard_());
    return navUpdate_(renderFn(summary));
  } catch (err) {
    return navUpdate_(buildErrorCard_(err));
  }
}

function navUpdate_(card) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(card))
    .build();
}

function navPush_(card) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card))
    .build();
}
