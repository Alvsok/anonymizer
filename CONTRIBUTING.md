# Contributing

## Reporting a bug

Open a [GitHub issue](https://github.com/Alvsok/anonymizer/issues/new).
Include the file format (`.xlsx`/`.csv`/`.tsv`), the browser, and — if you
can reproduce it — the smallest sample data that triggers it. Do not
attach real client data; a synthetic file that reproduces the shape of
the problem is enough.

Found a security issue (data leaving the browser, a token collision, a
real value surviving into `masked.zip`)? Use [private vulnerability
reporting](SECURITY.md) instead of a public issue.

## Proposing a change

Open an issue before a pull request for anything beyond a small fix —
the scope of what version 1 covers is intentionally narrow (see
`README.md`), and a change that looks obvious can be something already
considered and deliberately left out.

## Development

```
python3 -m venv .venv && source .venv/bin/activate
pip install -r tests/requirements.txt
pytest tests/ -v
```

`py/` is tested on plain CPython (`pytest`) and is where the guarantees
live. `js/` has no automated tests yet — verify changes by hand through a
local server (`python3 -m http.server`), per `README.md`.

## Pull requests

- Keep the diff scoped to the issue it addresses.
- Add or update tests in `tests/` for anything in `py/`.
- By submitting a pull request you agree that your contribution is
  licensed under this repository's [Apache-2.0 license](LICENSE).
