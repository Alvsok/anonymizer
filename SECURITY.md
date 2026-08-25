# Security Policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: open the **Security** tab of
this repository and choose **Report a vulnerability**. That opens a private
thread visible only to the maintainer — please use it instead of a public
issue, so a flaw is not published before it is fixed.

Expect a first reply within a week. If a report is confirmed, the fix and a
note in `CHANGELOG.md` follow; you will be credited unless you ask not to
be.

## What this tool promises

The whole product is one promise: **your file never leaves your browser.**
Everything below follows from that.

- No backend exists. There is no server to send a file to.
- No third-party domain is contacted, at any point. The Pyodide runtime and
  every `.whl` are vendored into this repository at pinned versions instead
  of being pulled from a CDN.
- A Content-Security-Policy of `default-src 'self'` makes the browser itself
  enforce this. The document declares it in a `<meta>` tag; `js/worker.js`,
  where all file processing happens, gets it from an HTTP response header
  (`_headers`), because a worker does not inherit the document's policy.
- The key that maps tokens back to real values is downloaded to you and
  never put in the archive with the masked file.

Anything that breaks one of those is a vulnerability. Some examples, to be
concrete:

- any network request to a host other than the page's own origin;
- the key, or any real value from the source file, ending up inside
  `masked.zip`;
- two different real values receiving the same token, which makes the key
  ambiguous and can hand the wrong value back on restore;
- a masked output still containing a value that the config asked to mask.

## What is not a vulnerability

**This is pseudonymization, not anonymization**, and the difference is
deliberate — the analyst has to be able to work with the file.

- **Amounts, dates and row counts stay real.** So does the number of
  distinct values in every column. Someone who already holds the same
  records from another source — a public registry, a leaked database —
  can match on those numbers and re-identify them. That is a property of
  the design, not a bug in it: the analyst has to be able to work with the
  file.
- **The key is not encrypted.** It is an ordinary file that you keep. Its
  extension is `.secretmap` rather than `.json` so it does not open on a
  double click in Excel and is harder to attach to an email by reflex —
  that is friction, not protection. Anyone who obtains the file can undo
  the masking.
- **Only the columns you tick are masked.** The tool proposes columns from
  the shape of their values and never reads meaning into column headings.
  A sensitive value in a column you left unticked stays as it is.
- **Free-text columns are handled by substring replacement.** A name that
  appears in prose is replaced only if that exact value is already in the
  key from some ticked column. Spelling variants are not caught: `Globex
  LLC` and `globex llc` are two different values and get two different
  tokens.
- **Nothing in `js/` is covered by tests.** The guarantees live in `py/`,
  which is tested on ordinary CPython with network sockets blocked. The
  browser layer is verified by hand. This is a known gap, stated in the
  README, not a hidden one.

## Supported versions

The deployed version at <https://anonymizer.alsok.org/> is the `main`
branch. Fixes go there; there are no maintained release branches.

## Verifying the promise yourself

You do not have to take any of this on trust:

1. Open your browser's developer tools and watch the Network tab through a
   whole session. Every request is to the page's own origin.
2. Load the page, wait for the engine to finish loading, then disconnect
   from the internet and process a file. It keeps working — a service
   worker holds the runtime in cache.
3. Read `py/`. It is ordinary Python, and it is where every decision about
   your data is made.
