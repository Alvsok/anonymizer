# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0-beta] - 2026-08-20

First public release, deployed at <https://anonymizer.alsok.org/>.

Load one spreadsheet, tick the columns to hide, press one button. Out come
two files: `masked.zip` for whoever analyzes your data, and a key that
stays with you.

### Added

- Masking of `.xlsx`, `.csv` and `.tsv` files entirely in the browser, on
  Pyodide, with no backend and no CDN.
- Deterministic tokens (`CUST-000007`) instead of realistic fake values, so
  a real value that slipped through is obvious at a glance rather than
  camouflaged.
- Numbering is shuffled, seeded from the key: the token number itself does
  not leak who came first or who is largest, and a second run with the same
  key reproduces the same tokens.
- A key file named `mapping.KEEP-PRIVATE.secretmap` — deliberately not
  `.json`, so it does not open on a double click in Excel and is harder to
  attach to an email by accident. It is never placed in the archive with
  the masked file.
- Free-text fallback: values already in the key are also replaced where
  they appear inside prose, not only in the columns they came from.
- Content-Security-Policy on the worker via `_headers`, because a worker
  does not inherit the document's policy and that is where all file
  processing happens.
- Offline operation after first load, through a service worker holding the
  runtime in cache.
- `SECURITY.md` stating what the tool promises and, at equal length, what
  it does not.

### Known limitations

- This is pseudonymization, not anonymization: amounts, dates and the
  number of distinct values stay real.
- One file per run. No batches, no folders.
- Excel formulas are read as values; the masked copy holds static numbers.
- Restoring real values from a token file is not part of this page yet.
  The engine (`py/restorer.py`) is written and tested but not reachable
  from the UI.
- Nothing in `js/` has automated tests.

[1.0.0-beta]: https://github.com/Alvsok/anonymizer/releases/tag/v1.0.0-beta
