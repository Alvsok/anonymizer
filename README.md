# anonymizer

Pseudonymization for Excel and CSV files. Runs entirely in your browser
(Pyodide) — no backend, and your data is never uploaded anywhere.

Load a file, tick the columns to hide, press the button. You get two
files back: `masked.zip`, which you send to whoever is analyzing your
data, and a key, which you keep. The masked columns hold deterministic
tokens such as `CUST-000007` instead of names, and the same value gets
the same token everywhere it appears.

The key maps those tokens back to the real values. Undoing the masking
with it is not part of this page — that moves to a page of its own.

**This is pseudonymization, not anonymization.** Amounts, dates and the
number of distinct values remain real, so a determined attacker could use
them (matching against public registries or leaked databases) to
re-identify records. The tool programmatically eliminates accidental
leakage of direct identifiers; it does not give you, and does not promise,
full anonymity.

## Why tokens instead of realistic fakes

`Globex LLC` becomes `CUST-000007`, not `Initech Inc`. The reason: a
realistic fake is indistinguishable from a real value that slipped
through — "John Smith" in a column could be either a substitution or a
leak. Sequential numbering makes any surviving real value obvious
instantly, so you can verify the result by eye in half a minute.

## How to verify nothing leaves your machine

Not on trust — four ways, in increasing order of rigor:

1. **The Network tab of your developer tools.** Across an entire session
   there is not one request to a third-party domain. Same origin only.
2. **Disconnect from the internet.** Once the engine has loaded (the page
   tells you when), pull the network and process a file. It keeps working:
   a service worker holds the Pyodide runtime in cache.
3. **CSP.** `index.html` declares
   `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self';`
   so the browser itself blocks any outbound call. `js/worker.js`, where
   all processing happens, gets its policy from a separate HTTP header
   (`_headers`), because a worker does not inherit the document's CSP.
4. **Read the code.** All the logic lives in `py/` as ordinary Python and
   is tested on ordinary CPython.

No CDNs: the Pyodide runtime and every `.whl` are vendored into this
repository at pinned versions. There is simply nothing for a third-party
domain to serve.

## The key stays with you

`mapping.KEEP-PRIVATE.secretmap` maps real values to tokens. Anyone holding it
can restore the original data, which is why it never goes into the
archive with the masked file and never leaves your machine. Its extension is
deliberately not `.json`, so it does not open on a double click in Excel
and is harder to attach to an email by accident. Lose it and the next run
will produce different tokens.

The tool produces exactly two files: `masked.zip` with your data, and the
key.

## Running it locally

A static site — any HTTP server will do:

```
python3 -m http.server 8000
```

then open `http://localhost:8000/index.html`.

## Tests

The logic in `py/` uses no browser APIs, so it is tested on ordinary
CPython — behavior is identical under Pyodide:

```
python3 -m venv .venv && source .venv/bin/activate
pip install -r tests/requirements.txt
pytest tests/ -v
```

`tests/test_acceptance.py` covers the acceptance criteria: idempotency,
one token per value, that amounts and dates come back untouched, and the
full `restore(mask(X)) == X` round trip. That last one is checked here
rather than in the browser on purpose — masking has to stay reversible
even while the page that reverses it does not exist yet.

The whole run executes with network sockets blocked
(`tests/conftest.py`) — if the engine ever tried to reach the network,
the suite would fail.

Nothing in `js/` is covered: the browser layer (worker, message API, CSP,
offline behavior) is verified by hand through the local server above, and
the little logic that lives in `main.js` — which columns you ticked, which
token prefix each one gets — has no automated test behind it. `py/` is
where the guarantees are.

## Known limitations

- **Excel formulas are read as values.** The masked copy holds static
  numbers, not a recalculating workbook. If the formulas matter, keep the
  original file.
- **One file per run.** No batches, no folders.
- Images, macros and embedded objects are not processed.
- One value written two ways (`Globex LLC` / `globex llc`) gets two
  different tokens. Merging them silently would be a judgment about your
  data rather than anonymization.
- **Column headings are not analyzed at all.** The tool proposes masking
  based on the shape of the *values* — numbers and dates are left alone,
  text is proposed — and a heading can say anything, so guessing meaning
  from it would only produce confident-looking mistakes.
- **A column is masked under its own name.** Columns sharing a name share
  a token space, which is how one value keeps one token across every sheet
  of a workbook. Two columns whose names differ never line up, even when
  they hold the same thing.

## Layout

- `py/` — all the logic: config, file parsing, the token dictionary and
  masking. `restorer.py` and `report.py` are complete and tested but not
  wired to this page; they belong to work that is not released yet.
- `js/` — `main.js` (main thread, DOM) and `worker.js` (Pyodide,
  processing), talking over a message API.
- `vendor/` — Pyodide, the `openpyxl`/`et_xmlfile`/`micropip` wheels, and
  JSZip. Versions are pinned; updating means deliberately replacing files.
- `_headers` — the worker's CSP when served from Cloudflare Pages.

## Feedback

Suggestions and bug reports are welcome —
[open an issue](https://github.com/Alvsok/anonymizer/issues/new) or write
to [alsok@alsok.org](mailto:alsok@alsok.org).

## License

Apache-2.0, see `LICENSE`.
