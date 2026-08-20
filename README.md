# anonymizer

Pseudonymization for Excel and CSV files. Runs entirely in your browser
(Pyodide) — no backend, and your data is never uploaded anywhere. It
replaces direct identifiers (names, emails, phone numbers, counterparty
names, account numbers) with deterministic tokens such as `CUST-0007`,
preserving referential integrity across files and sheets, and it can
reverse the operation — `restore` — using your own dictionary.

**This is pseudonymization, not anonymization.** Amounts, dates and the
number of distinct values remain real, so a determined attacker could use
them (matching against public registries or leaked databases) to
re-identify records. The tool programmatically eliminates accidental
leakage of direct identifiers; it does not give you, and does not promise,
full anonymity.

## Why tokens instead of realistic fakes

`Globex LLC` becomes `CUST-0007`, not `Initech Inc`. The reason: a
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

## The dictionary is the key, and it stays with you

`mapping.KEEP-PRIVATE.json` maps real values to tokens. Anyone holding it
can restore the original data, which is why it is never placed in the
archive with the masked files and never sent anywhere. Lose it and the
next run will produce different tokens.

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

`tests/test_acceptance.py` covers the acceptance criteria: the full
`restore(mask(X)) == X` round trip, idempotency, one token per value
across every file, and the absence of source values in the report. The
whole run executes with network sockets blocked (`tests/conftest.py`) — if
the engine ever tried to reach the network, the suite would fail.

The browser layer (worker, message API, CSP, offline behavior) is still
verified by hand through the local server above; there are no automated
tests at that level yet.

## Known limitations

- **Excel formulas are read as values.** After `restore` you get static
  numbers, not a recalculating workbook. If the formulas matter, keep the
  original file.
- Images, macros and embedded objects are not processed.
- One value written two ways (`Globex LLC` / `globex llc`) gets two
  different tokens. Merging them silently would be a judgment about your
  data rather than anonymization.
- **Column headings are not analyzed at all.** The tool proposes masking
  based on the shape of the *values* (numbers and dates are left alone,
  text is proposed), and you name the entity each column belongs to. A
  heading can say anything, so guessing from it would only produce
  confident-looking mistakes — and a pre-filled wrong guess is worse than
  an empty field.

## Layout

- `py/` — all the logic: config, file parsing, link detection, the token
  dictionary, masking, restoring, reporting.
- `js/` — `main.js` (main thread, DOM) and `worker.js` (Pyodide,
  processing), talking over a message API.
- `vendor/` — Pyodide, the `openpyxl`/`et_xmlfile`/`micropip` wheels, and
  JSZip. Versions are pinned; updating means deliberately replacing files.
- `_headers` — the worker's CSP when served from Cloudflare Pages.

## License

Apache-2.0, see `LICENSE`.
