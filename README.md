# Drive Hygiene Advisor

A Google Workspace Add-on (Apps Script + CardService) that runs inside **Google Drive's side panel** and gives a user a quick read on their **My Drive**: a Drive Hygiene Score, possible duplicate files, the largest files by storage, and files whose sharing settings look risky. It reads Drive **metadata only** — it never opens or reads file content.

This was built as a self-contained prototype: no backend server, no database — everything runs in Apps Script against the user's own Google account.

---

## 1. What's in this repo

```
addon/                   Apps Script project (the actual add-on)
  appsscript.json         Manifest: OAuth scopes, add-on triggers, advanced Drive service
  Code.js                 Entry points wired to CardService triggers/actions
  DriveScanner.js         Pagination, streaming aggregation, checkpoint/resume, retries
  Cards.js                All CardService UI (the only file that builds user-facing text)
  DuplicateDetector.js     Duplicate-detection rules (pure logic, unit-tested)
  RiskScorer.js            Risk-scoring rules (pure logic, unit-tested)
  StorageInsights.js       Storage aggregation (pure logic, unit-tested)
  HygieneScore.js          Composite score formula (pure logic, unit-tested)
  Utils.js                 Formatting/helper functions (pure logic, unit-tested)
tests/                    Node test-runner unit tests for the pure logic modules
README.md                 This file
DECISIONS.md              ~5 key product/engineering decisions and why
```

The "pure logic" files (`DuplicateDetector.js`, `RiskScorer.js`, `StorageInsights.js`, `HygieneScore.js`, `Utils.js`) have no Apps Script dependencies, so they run and are tested directly under Node. `Code.js`, `Cards.js`, and `DriveScanner.js` call Apps Script services (`CardService`, `Drive`, `PropertiesService`, `ScriptApp`, `Session`) and only run inside the Apps Script runtime.

---

## 2. Prerequisites

- A Google account (any account works — nothing in this project is tied to a specific domain, email, or file).
- [Node.js](https://nodejs.org/) 18+ (only needed for `clasp` and running the unit tests).
- [`clasp`](https://github.com/google/clasp), Google's official Apps Script CLI. It's listed as a dev dependency, so `npm install` is enough — no global install required.

```bash
npm install
```

---

## 3. One-time setup: create and push the Apps Script project

1. **Log in to clasp** (opens a browser window against *your own* Google account):
   ```bash
   npx clasp login
   ```
2. **Create the Apps Script project**, rooted at `addon/`:
   ```bash
   npx clasp create --type standalone --title "Drive Hygiene Advisor" --rootDir ./addon
   ```
   This writes `addon/.clasp.json` with your new project's `scriptId` (this file is gitignored since it's account-specific — `addon/.clasp.json.example` shows the shape).
3. **Push the source**:
   ```bash
   cd addon && npx clasp push
   ```
4. **Drive API / OAuth consent — usually nothing to do.** New standalone scripts use Apps Script's own auto-managed Cloud project (shown as **GCP: Default** under **Project Settings**). In that mode, pushing a manifest with `enabledAdvancedServices` (as `appsscript.json` does for the Drive v3 service) is enough — Apps Script enables the API automatically, and there's no separate OAuth consent screen to configure for running the add-on under your own account.

   Only if `Project Settings → Google Cloud Platform (GCP) Project` shows a **real project number** (meaning you or clasp explicitly linked a standard Cloud project) do you need the manual path: in that linked Cloud Console project, enable **Drive API** under **APIs & Services → Library**, and set the **OAuth consent screen** to **External** / **Testing**, adding your own account as a test user.

---

## 4. Install it as a test deployment in your own Drive

1. In the Apps Script editor, click **Deploy → Test deployments**.
2. Click **Install add-on**, then **Install** and accept the permission prompt (this is where you'll see the exact `drive.metadata.readonly` scope being requested — nothing broader).
3. Open **[drive.google.com](https://drive.google.com)** in the same Google account, refresh the page.
4. Click the **add-ons (puzzle piece) icon** in the right-hand side panel and select **Drive Hygiene Advisor**.
5. The add-on's homepage card opens. Click **Run analysis**.

That's the entire deliverable running live: no separate website, no admin console — just Drive's own side panel.

> If you'd rather deploy a **versioned** deployment instead of a live "head" test deployment, run `npx clasp deploy` from `addon/`, then pick that deployment version under **Test deployments**. Either works for this exercise; the head deployment is simplest during development since `clasp push` updates it instantly.

---

## 5. OAuth scopes used (and why)

| Scope | Used for |
|---|---|
| `https://www.googleapis.com/auth/drive.addons.metadata.readonly` | The add-on-specific variant of the metadata scope. Apps Script's authorization layer maps `Drive.Files.list()`/`Drive.Files.get()` calls made from *inside a Workspace Add-on's* execution context to this scope specifically — declaring only the general `drive.metadata.readonly` scope produces a runtime "required permissions" error even though functionally they cover the same data. This is actually the more correct, more narrowly-scoped choice for an add-on and is what's shown on the consent screen. |
| `https://www.googleapis.com/auth/drive.metadata.readonly` | Declared alongside the add-on-specific scope above for the same metadata fields (name, size, mimeType, checksum, sharing/permissions, modified date). **Neither scope ever grants access to file content.** |
| `https://www.googleapis.com/auth/script.storage` | Cache the last scan's summary and an in-progress checkpoint via `PropertiesService`, scoped to the individual user, so the homepage loads instantly and a long scan can resume after a timeout. |
| `https://www.googleapis.com/auth/userinfo.email` | Read the signed-in user's own email address (`Session.getActiveUser().getEmail()`) purely to derive their email domain at runtime, so "shared outside your organization" can be computed without ever hardcoding a domain. No other profile info is requested. |

> **Note on scope discovery**: this is a real gotcha worth calling out during the walkthrough — Apps Script does not always treat a general Drive scope as satisfying an add-on's API calls. The fix was discovered from the runtime's own error message ("Required permissions: https://www.googleapis.com/auth/drive.addons.metadata.readonly"), not guessed in advance.

Scopes **not** requested, on purpose: any `drive` write scope (nothing is ever renamed, moved, or deleted), `drive.readonly`/`drive.file` (would allow reading file *content*, which this add-on never needs), and anything for Shared Drives or domain administration.

---

## 6. Running the unit tests

```bash
npm test
```

This runs Node's built-in test runner (`node --test`) against `tests/*.test.js`, covering the duplicate-detection rules, risk-scoring rules, storage aggregation, the hygiene-score formula, and the formatting helpers — 27 tests, no dependencies beyond Node itself. These are the parts of the add-on with real decision logic; `Cards.js`/`Code.js`/`DriveScanner.js` are thin Apps-Script-only wiring around them and are exercised by the live demo instead.

---

## 7. How the analysis works (short version — see DECISIONS.md for the reasoning)

- **Scope**: only files where `'me' in owners` (My Drive, owned by the signed-in user) — no Shared Drives, no domain-wide scanning.
- **Cap**: the first **300** files, ordered by most-recently-modified, paginated 100 at a time. This cap is shown directly in the Overview card footer ("Scanned 300 files (prototype cap...)") — it is never hidden or implied to be a full-Drive scan.
- **Duplicates**: checksum match → *Confirmed*; same normalized name + type + size (no checksum) → *Likely*; same normalized name + type but size unknown (typical for Google Docs/Sheets/Slides) → *Possible*.
- **Risk**: a weighted point score from sharing/permission metadata only (public link access, organization-wide access, external domains, sensitive-looking filenames *combined with* sharing, staleness) mapped to Low/Medium/High. Every flagged file shows the exact reasons in plain English.
- **Storage**: total bytes scanned, largest files, and a breakdown by category. Google-native files without a reported size are counted and called out rather than treated as 0 bytes.
- **Hygiene Score**: `100 − risk penalty − duplicate-waste penalty`, clamped to `[0, 100]`.

---

## 8. Scaling beyond this prototype

The assignment asks the prototype to be designed with an eye toward "millions of files across a domain," without building that infrastructure inside Apps Script. Concretely, this prototype already does the following, and each maps to what would change at real scale:

| In this prototype | At real (domain-wide, millions-of-files) scale |
|---|---|
| Paginates the Drive API 100 files at a time and **folds each page into a small running total** (sums, a capped top-15 large-files list, a capped risky-files list) instead of keeping every API response in memory. | Same idea, but the fold/reduce step runs in a stream/batch processing job (e.g., Cloud Run/Dataflow), not a single script execution. |
| Retries transient Drive API errors (`429`/`500`/`503`) with exponential backoff, up to 3 attempts. | Same principle, plus a proper dead-letter/retry queue and per-user quota budgeting. |
| If a scan risks exceeding Apps Script's ~6-minute execution limit, it **checkpoints progress to `PropertiesService`** (the last page token + running aggregates) and schedules a one-off trigger to resume — see `scheduleContinuation_()`/`continueScan()` in `DriveScanner.js`. | This is exactly the sync→async boundary: a "start scan" request would enqueue a background job (Cloud Tasks/Pub-Sub) and return immediately; the add-on would poll or be notified when results are ready, rather than Apps Script polling itself via triggers. |
| Keeps one lightweight record per scanned file (id/name/mimeType/size/checksum) in memory to detect duplicates across the whole capped sample. | Bounded only because the sample is capped at 300. At real scale this becomes an external index — e.g., a `checksum → [fileIds]` and `normalizedName+size → [fileIds]` lookup in Firestore/BigQuery — so duplicate matching doesn't require holding the whole corpus in memory anywhere. |
| Stores only the **last scan's summary** (small, aggregated JSON) via `PropertiesService`, capped well under its size limits. | Raw + aggregated results would live in a real datastore (BigQuery for analytics/rollups, Firestore for per-file records) so history, trends, and drill-downs don't depend on script storage limits. |
| The Apps Script add-on both *scans* and *renders*. | The add-on becomes purely the **presentation layer**: it triggers a backend job and renders results a backend already computed, the same way it renders cached results here. |

---

## 9. Known limitations (by design, per the assignment's scope)

- My Drive only — Shared Drives and "Shared with me" are out of scope.
- No deletion, bulk remediation, or scheduled/background scanning beyond the single checkpoint/resume mechanism described above.
- The 300-file cap means very large drives only see their most recently modified slice per scan; re-running the scan re-samples the same ordering (most-recently-modified first), so it stays representative as files change.
- Duplicate detection is a heuristic without checksums for Google-native files — labelled confidence tiers exist specifically so the UI never overstates certainty.
- Risk scoring only sees sharing metadata, not content — it cannot know a file is *actually* sensitive, only that it looks that way by name and is exposed.
