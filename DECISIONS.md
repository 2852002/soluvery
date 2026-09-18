# Key decisions

The assignment deliberately leaves several rules undefined. These are the decisions I made, and why. (See `README.md` §7-9 for the resulting behavior, and the doc-comments at the top of each `addon/*.js` file for the exact rules as implemented.)

## 1. Duplicate detection: tiered confidence instead of one binary rule

Drive gives inconsistent signal for "is this a duplicate": binary files have an `md5Checksum`, but Google-native Docs/Sheets/Slides never do, and don't reliably report `size` either. A single rule ("same name and size") would produce false positives on Google-native files (two unrelated blank documents both named "Untitled document") and false negatives on renamed binary duplicates.

Instead, I built three tiers, tried in order of strength, and a file is only ever claimed by the strongest tier it matches (so groups never overlap):

1. **Confirmed** — matching `md5Checksum` (+ size). This is provably identical content.
2. **Likely** — no checksum on at least one side, but same normalized name + mimeType + exact size.
3. **Possible** — same normalized name + mimeType, but size can't be compared (typical for Google-native files).

Name normalization strips common copy artifacts (`" (1)"`, `" copy"`, `" - Copy (2)"`) so `Report.pdf` and `Report (1).pdf` are recognized as the same underlying name.

**Why this matters**: the UI always shows the confidence tier and a one-sentence reason (`DuplicateDetector.js` generates the reason string per group), so a user sees *why* something was flagged instead of a flat "duplicate" label they'd have to trust blindly.

## 2. Risk scoring: metadata-only, explainable, and "exposure" not "guessed sensitivity"

With only a metadata scope, the only real signal for risk is *who can access the file* — not what's in it. I built a small weighted-point system (see `RiskScorer.js` header comment for the full table) over: public link sharing (and its role — edit vs. comment vs. view), organization-wide sharing, sharing with each external domain, filename keywords that suggest sensitive content, and staleness.

The one deliberate rule I want to call out: a file with a sensitive-looking name (e.g. `passwords.xlsx`) that **isn't shared with anyone** scores **Low**, not High. Content sensitivity by itself isn't something this add-on can verify (it never reads content), so I treat "risk" strictly as *exposure* — a private file, however alarmingly named, isn't exposed. The filename signal only adds points once the file is already shared beyond its owner. This avoids the add-on crying wolf about a user's own private files and keeps every flagged reason defensible from metadata alone.

Every score decomposes into the specific rules that fired (`reasons: string[]`), and the card UI renders those sentences directly — never the raw permissions array.

## 3. My Drive scope + an explicit, visible file cap, ordered by recency

The assignment allows capping the scan and explicitly says to show the cap rather than imply an unlimited scan. I capped at the **300 most-recently-modified** files owned by the signed-in user (`'me' in owners`, excluding trashed), fetched 100 at a time.

Two reasons for "most-recently-modified" as the ordering, over e.g. "largest first" or Drive's default order: (1) it's the most representative slice for a "hygiene check-in" use case — a user cares more about recent clutter and recent risky shares than a file untouched since 2014 that already got flagged the last time this ran; (2) it makes repeated runs meaningfully re-sample as the user's Drive changes, rather than being frozen on the same 300 files forever. The cap and ordering are stated in plain text on every card ("Scanned 300 files (prototype cap...), most recently modified").

## 4. Bounded, streaming aggregation instead of loading all files into memory

Rather than collecting the full list of file objects and then running duplicate/risk/storage analysis over it, `DriveScanner.js` folds each page of results into a small **accumulator** as it arrives (running byte totals, a capped top-15 largest-files list, a capped list of only the Medium/High-risk files) and discards the rest of each raw API response immediately. This directly reflects the assignment's hint about not loading large datasets into memory — the accumulator's size is bounded by the cap on *kept* items, not by how many files were scanned.

The one exception is duplicate detection, which fundamentally needs to compare files against each other across the whole scan — so a minimal per-file record (id/name/mimeType/size/checksum, not the full API response) is retained, bounded by the 300-file cap. I call this out explicitly in the README's scaling section as the piece that would move to an external index (e.g. a checksum→fileIds lookup in a real datastore) if the cap were lifted.

I also implemented (not just described) the sync→async boundary the assignment asks about: if a scan is taking long enough to risk Apps Script's execution limit, `runAnalysis()` checkpoints the accumulator and the next page token to `PropertiesService` and schedules a one-off trigger (`continueScan`) to resume. At the prototype's 300-file cap this path essentially never triggers in practice — the whole scan finishes in a few seconds — but the code is real and exercised by lowering `SCAN_CONFIG.EXECUTION_SAFETY_MS`/`MAX_FILES` locally, not just described in prose.

## 5. Least-privilege OAuth: `drive.metadata.readonly`, not `drive.readonly`

The add-on only ever needs file names, sizes, mimeTypes, checksums, timestamps, and sharing/permission metadata — never file content. `drive.metadata.readonly` covers all of that (including the `permissions` field used for risk scoring) without granting the ability to open/download file bodies, which `drive.readonly` or `drive.file` would allow. I also skipped any write scope entirely, since the assignment explicitly excludes deletion/remediation from scope — there is no code path in this add-on that can modify or delete a file. The manifest additionally enables `script.storage` only because `PropertiesService` is used for caching results per-user; no other scope is requested.

## 6. UI: fixed navigation across four sections, never raw API data

Every non-homepage card (`Cards.js`) starts with the same four-button row (Overview / Duplicates / Large Files / Risky Files) so the add-on reads as one small app with sections, not a chain of disconnected screens. Every number shown is formatted (`formatBytes`, relative dates) and every flagged item is clickable through to a detail card that lists the specific reasons in full sentences — at no point does any card serialize or dump a Drive API response object. This was a conscious trade-off: it means every new signal added to risk/duplicate detection also requires writing its explanation sentence in the same commit, which is the point — an unexplainable signal shouldn't ship.
