import csv as csv_module
import hashlib
import html
import json
from pathlib import Path

import openpyxl

from config import columns_for_file
from engine import unsupported_format_message


def collect_column_stats(source_path, file_pattern, config, max_examples=3):
    """One pass over the file. For columns declared in the config
    (`touched`) it records how many distinct non-empty values there were --
    never the values themselves (design.md §11.5: source values of touched
    columns must not reach the report). For the rest (`untouched`) it keeps
    up to `max_examples` raw sample values (design.md §6: "the untouched
    section comes first, with examples"). Returns
    `({sheet: {column: {...}}}, row_count)`.
    """
    if source_path.lower().endswith(".xlsx"):
        return _collect_xlsx(source_path, file_pattern, config, max_examples)
    if source_path.lower().endswith((".csv", ".tsv")):
        return _collect_csv(source_path, file_pattern, config, max_examples)
    raise ValueError(unsupported_format_message(source_path))


def _new_column_stat(name, plan):
    return {
        "name": name,
        "touched": plan is not None,
        "entity": plan["entity"] if plan else None,
        "_seen": set() if plan else None,
        "examples": [] if plan is None else None,
    }


def _record(stat, value, max_examples):
    if value is None or value == "":
        return
    if stat["touched"]:
        stat["_seen"].add(str(value))
    elif len(stat["examples"]) < max_examples and value not in stat["examples"]:
        stat["examples"].append(value)


def _finalize(stats_by_index):
    result = {}
    for stat in stats_by_index.values():
        entry = {"touched": stat["touched"], "entity": stat["entity"], "examples": stat["examples"]}
        if stat["touched"]:
            entry["unique_masked"] = len(stat["_seen"])
        result[stat["name"]] = entry
    return result


def _collect_xlsx(source_path, file_pattern, config, max_examples):
    plan_by_sheet = columns_for_file(config, file_pattern)
    wb = openpyxl.load_workbook(source_path, read_only=True, data_only=True)
    sheets = {}
    row_count = 0
    for ws in wb.worksheets:
        sheet_plan = plan_by_sheet.get(ws.title, {})
        stats_by_index = {}
        header = None
        for row in ws.iter_rows(values_only=True):
            if header is None:
                header = row
                for i, c in enumerate(row):
                    name = str(c) if c is not None else f"col_{i}"
                    stats_by_index[i] = _new_column_stat(name, sheet_plan.get(name))
                continue
            row_count += 1
            for i, value in enumerate(row):
                if i in stats_by_index:
                    _record(stats_by_index[i], value, max_examples)
        sheets[ws.title] = _finalize(stats_by_index)
    wb.close()
    return sheets, row_count


def _collect_csv(source_path, file_pattern, config, max_examples):
    # file_pattern, not source_path -- same reason as in masker.py:
    # source_path is the worker's temp path, while the CSV pseudo sheet name
    # has to match what the config stored, not that path.
    sheet_name = Path(file_pattern).stem
    plan_by_sheet = columns_for_file(config, file_pattern)
    sheet_plan = plan_by_sheet.get(sheet_name, {})
    delimiter = "\t" if source_path.lower().endswith(".tsv") else ","
    row_count = 0
    with open(source_path, newline="", encoding="utf-8") as f:
        reader = csv_module.reader(f, delimiter=delimiter)
        header = next(reader, [])
        stats_by_index = {
            i: _new_column_stat(name, sheet_plan.get(name)) for i, name in enumerate(header)
        }
        for row in reader:
            row_count += 1
            for i, value in enumerate(row):
                if i in stats_by_index:
                    _record(stats_by_index[i], value, max_examples)
    return {sheet_name: _finalize(stats_by_index)}, row_count


def build_report(files_stats, files_row_counts, config, mapping):
    """files_stats: {file_name: {sheet: {column: {...}}}} -- the output of
    `collect_column_stats` for every file in the run.
    files_row_counts: {file_name: int}.
    """
    untouched, touched = [], []
    for file_name, sheets in files_stats.items():
        for sheet_name, columns in sheets.items():
            for column_name, stat in columns.items():
                if stat["touched"]:
                    touched.append(
                        {
                            "file": file_name,
                            "sheet": sheet_name,
                            "column": column_name,
                            "entity": stat["entity"],
                            "unique_masked": stat["unique_masked"],
                        }
                    )
                else:
                    untouched.append(
                        {
                            "file": file_name,
                            "sheet": sheet_name,
                            "column": column_name,
                            "examples": stat["examples"],
                        }
                    )

    tokens_count = sum(len(e["values"]) for e in mapping["entities"].values())
    fingerprint_source = json.dumps(config, sort_keys=True) + mapping["seed"]
    fingerprint = hashlib.sha256(fingerprint_source.encode()).hexdigest()[:12]

    return {
        "untouched": untouched,
        "touched": touched,
        "summary": {
            "files": len(files_stats),
            "rows": sum(files_row_counts.values()),
            "entities": len(config.get("entities", {})),
            "tokens": tokens_count,
        },
        "fingerprint": fingerprint,
    }


def render_report_html(report):
    e = html.escape
    untouched_rows = "".join(
        f"<tr><td>{e(u['file'])}</td><td>{e(u['sheet'])}</td><td>{e(u['column'])}</td>"
        f"<td>{', '.join(e(str(v)) for v in u['examples'])}</td>"
        f"<td><label><input type='checkbox' class='flag'> this should be masked too</label></td></tr>"
        for u in report["untouched"]
    )
    touched_rows = "".join(
        f"<tr><td>{e(t['file'])}</td><td>{e(t['sheet'])}</td><td>{e(t['column'])}</td>"
        f"<td>{e(t['entity'])}</td><td>{t['unique_masked']}</td></tr>"
        for t in report["touched"]
    )
    s = report["summary"]
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Masking report</title>
<style>
body {{ font-family: -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #222; }}
h1 {{ font-size: 1.4rem; }}
h2 {{ font-size: 1.1rem; margin-top: 32px; }}
table {{ border-collapse: collapse; width: 100%; margin-top: 12px; font-size: 14px; }}
th, td {{ border: 1px solid #ddd; padding: 6px 10px; text-align: left; }}
th {{ background: #f7f7f8; }}
.warn {{ background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 6px; padding: 12px 16px; }}
.summary {{ display: flex; gap: 24px; margin-top: 12px; }}
.summary div {{ background: #f7f7f8; border-radius: 6px; padding: 10px 16px; }}
#flagged {{ margin-top: 8px; font-size: 14px; }}
</style></head>
<body>
<h1>Masking report</h1>
<p>Run fingerprint: <code>{e(report['fingerprint'])}</code></p>

<h2>Left untouched — check this first</h2>
<div class="warn">These columns are unchanged from the source file. If anything
here should not have left your machine, flag it and go back to the column
mapping.</div>
<table>
<tr><th>File</th><th>Sheet</th><th>Column</th><th>Sample values</th><th></th></tr>
{untouched_rows if untouched_rows else "<tr><td colspan='5'>No untouched text columns.</td></tr>"}
</table>
<div id="flagged"></div>

<h2>What was replaced</h2>
<table>
<tr><th>File</th><th>Sheet</th><th>Column</th><th>Entity</th><th>Distinct values replaced</th></tr>
{touched_rows if touched_rows else "<tr><td colspan='5'>No columns were replaced.</td></tr>"}
</table>

<h2>Summary</h2>
<div class="summary">
<div>Files: {s['files']}</div>
<div>Rows: {s['rows']}</div>
<div>Entities: {s['entities']}</div>
<div>Tokens: {s['tokens']}</div>
</div>

<script>
document.querySelectorAll('.flag').forEach(cb => cb.addEventListener('change', () => {{
  const row = cb.closest('tr');
  const column = row.children[2].textContent;
  const list = document.getElementById('flagged');
  if (cb.checked) {{
    const li = document.createElement('div');
    li.textContent = 'Flagged: ' + column;
    li.dataset.col = column;
    list.appendChild(li);
  }} else {{
    list.querySelectorAll('div').forEach(d => {{ if (d.dataset.col === column) d.remove(); }});
  }}
}}));
</script>
</body></html>
"""
