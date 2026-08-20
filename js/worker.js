// Defense in depth, not the primary guarantee: a Worker does NOT inherit
// the parent document's CSP, whether set via <meta> or an HTTP header on
// the document — per spec, a same-origin http(s) worker needs its own
// Content-Security-Policy response header on the worker script's own
// request. A host that cannot set custom headers (GitHub Pages, for one)
// leaves this worker's network calls unrestricted by the browser even
// when index.html carries a strict CSP meta tag — verified live: an
// unguarded cross-origin fetch from here succeeds.
// This guard is a code-level backstop against our own mistakes — it is
// not equivalent to a real CSP and does not stop a determined attacker
// with code-execution here. The real enforcement comes from the
// Content-Security-Policy header this file is served with; see the
// `_headers` file in the repository root (`design.md` §9.3).
const OWN_ORIGIN = self.location.origin;
// Side effect of the same interception: collect the real URLs of vendor
// files fetched here (Pyodide loads .wasm/.zip/packages through fetch),
// so that after "ready" main.js can verify/backfill them into the offline
// cache (§10, design.md §9.1) — without hardcoding the Pyodide core file
// list, which lives inside loadPyodide() and changes between versions.
const fetchedVendorUrls = new Set();
const realFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  const resolved = new URL(url, OWN_ORIGIN);
  if (resolved.origin !== OWN_ORIGIN) {
    return Promise.reject(new Error("blocked: cross-origin fetch from worker: " + url));
  }
  if (resolved.pathname.includes("/vendor/")) fetchedVendorUrls.add(resolved.href);
  return realFetch(input, init);
};
self.XMLHttpRequest = function () {
  throw new Error("blocked: XMLHttpRequest is not used by this app");
};
self.WebSocket = function () {
  throw new Error("blocked: WebSocket is not used by this app");
};

// Message API (main thread <-> this worker), design.md §9.2.
//
// main -> worker:
//   { type: "init" }
//   { type: "preview", id, name, buffer }   -- buffer is a transferable ArrayBuffer
//   { type: "build-config", id, config }    -- config is a plain JS object
//     shaped like AnonConfig (py/config.py), built from the §4 UI state
//   { type: "build-mapping", id, config, files, existingMappingJson? }
//     files[i] = { name, buffer, sheetColumns } -- buffer transferable,
//     re-read from disk (design.md §9.2 item 4); existingMappingJson --
//     mapping.json text to append to (design.md §4), optional
//   { type: "mask", id, name, buffer, config, mappingJson }  -- buffer
//     transferable, re-read from disk; mappingJson -- mapping.json text
//     from §6 (a finished token dictionary is required, mask does not
//     build one itself)
//   { type: "restore", id, name, buffer, mappingJson }  -- a standalone
//     flow (design.md §2); needs no config, searches for tokens in a file
//     of any supported format rather than working by column
//   { type: "build-report", id, config, mappingJson, files }  -- files[i]
//     = { name, buffer }; re-reads every file from scratch (design.md
//     §9.2) and builds report.html (design.md §6)
//
// worker -> main:
//   { type: "status", text }
//   { type: "ready", vendorAssets }  -- vendorAssets: URLs of the vendor
//     files actually fetched during init (§10) -- main.js uses them to
//     verify/backfill the offline set
//   { type: "error", id?, message }
//   { type: "preview-result", id, name, sheets }
//     sheets[sheetName] = { columns, rows, guesses } -- every sheet of a
//     workbook is its own table (design.md §5); guesses[i] = { column,
//     entity, shape, touch, reason } (design.md §7, py/heuristics.py) --
//     level 0, a guess; the user corrects it on screen (§4) before
//     sending build-config
//   { type: "config-result", id, json?, error? } -- json: the validated
//     AnonConfig (py/config.py:config_to_json); error: ConfigError.message
//     when validation fails (duplicate prefixes, for example)
//   { type: "mapping-result", id, json?, error? } -- json: mapping.json
//     (py/mapping.py:mapping_to_json); never placed inside masked.zip
//     (design.md §6) -- separate download, separate warning
//   { type: "mask-result", id, name, buffer?, summary?, error? } --
//     buffer: transferable ArrayBuffer holding the masked file (same
//     format as the source); summary: {cells_masked} (py/masker.py)
//   { type: "restore-result", id, name, buffer?, summary?, error? } --
//     summary: {cells_restored} (xlsx) or {tokens_replaced} (text)
//   { type: "report-result", id, html?, error? } -- html: the standalone
//     report.html page (py/report.py:render_report_html), no network

const PYODIDE_INDEX = new URL("../vendor/pyodide/", import.meta.url).href;
const WHEELS = [
  new URL("../vendor/wheels/et_xmlfile-2.0.0-py3-none-any.whl", import.meta.url).href,
  new URL("../vendor/wheels/openpyxl-3.1.5-py2.py3-none-any.whl", import.meta.url).href,
];
const PY_MODULES = [
  "config.py",
  "heuristics.py",
  "engine.py",
  "mapping.py",
  "masker.py",
  "restorer.py",
  "report.py",
];

let pyodide;
let analyzeFile; // Python callable, set after engine.py loads

function post(msg) {
  self.postMessage(msg);
}

function status(text) {
  post({ type: "status", text });
}

async function init() {
  try {
    status("Loading Pyodide (from our own domain, no CDN)…");
    // A dynamic import() does not go through self.fetch (the interception
    // above never sees it) — add this file to the list by hand. The other
    // vendor files (.wasm, .zip, .whl) are fetched by loadPyodide()/micropip
    // and land in fetchedVendorUrls on their own.
    fetchedVendorUrls.add(PYODIDE_INDEX + "pyodide.mjs");
    const { loadPyodide } = await import(PYODIDE_INDEX + "pyodide.mjs");
    pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX });
    status("Pyodide loaded.");

    status("Installing openpyxl from local .whl files…");
    await pyodide.loadPackage("micropip");
    const micropip = pyodide.pyimport("micropip");
    await micropip.install(WHEELS);
    status("openpyxl installed.");

    pyodide.FS.mkdirTree("/app");
    for (const name of PY_MODULES) {
      const src = await (await fetch(new URL("../py/" + name, import.meta.url))).text();
      pyodide.FS.writeFile("/app/" + name, src);
    }
    pyodide.runPython("import sys\nsys.path.insert(0, '/app')");
    await pyodide.runPythonAsync("import config, engine, mapping, masker, restorer, report");

    const version = pyodide.runPython("engine.engine_version()");
    status(`Engine ready: openpyxl ${version}.`);

    analyzeFile = pyodide.runPython("engine.analyze_file");
    post({ type: "ready", vendorAssets: Array.from(fetchedVendorUrls) });
  } catch (err) {
    post({ type: "error", message: err.message });
  }
}

function handlePreview(msg) {
  const { id, name, buffer } = msg;
  try {
    const path = "/tmp/" + id + "-" + name;
    pyodide.FS.writeFile(path, new Uint8Array(buffer));
    // file_pattern = the original file name, not the temp path -- otherwise
    // the pseudo sheet name of a CSV depends on whichever handler's prefix
    // built the path (design.md §9.2, found live while verifying §10).
    const result = analyzeFile(path, name).toJs({ dict_converter: Object.fromEntries });
    pyodide.FS.unlink(path);
    post({ type: "preview-result", id, name, sheets: result.sheets });
  } catch (err) {
    post({ type: "error", id, message: err.message });
  }
}

function lastTracebackLine(message) {
  // pyodide.PythonError.message is the full traceback; the user only needs
  // the last line (`ExceptionType: text`), not the whole stack.
  const lines = message.trim().split("\n");
  return lines[lines.length - 1];
}

function handleBuildConfig(msg) {
  try {
    pyodide.globals.set("_raw_config_json", JSON.stringify(msg.config));
    const validated = pyodide.runPython(
      "config.config_to_json(config.config_from_json(_raw_config_json))"
    );
    post({ type: "config-result", id: msg.id, json: validated });
  } catch (err) {
    post({ type: "config-result", id: msg.id, error: lastTracebackLine(err.message) });
  }
}

function handleBuildMapping(msg) {
  // msg: { id, config, files: [{name, buffer, sheetColumns}], existingMappingJson? }
  // Files are re-read from disk (design.md §9.2, item 4) -- the bytes used
  // for the preview / link search were already neutered by the transfer,
  // so this is a fresh buffer taken from loadedFiles.
  try {
    const flatValues = {};
    for (const f of msg.files) {
      const path = "/tmp/map-" + msg.id + "-" + f.name;
      pyodide.FS.writeFile(path, new Uint8Array(f.buffer));
      pyodide.globals.set("_sheet_columns_json", JSON.stringify(f.sheetColumns));
      pyodide.globals.set("_extract_path", path);
      pyodide.globals.set("_extract_file_pattern", f.name);
      const extractedJson = pyodide.runPython(
        "import json\n" +
          "json.dumps(engine.extract_unique_values(_extract_path, json.loads(_sheet_columns_json), file_pattern=_extract_file_pattern))"
      );
      pyodide.FS.unlink(path);
      const extracted = JSON.parse(extractedJson); // {sheet: {col: {values, unique_count, truncated}}}
      flatValues[f.name] = {};
      for (const [sheetName, cols] of Object.entries(extracted)) {
        flatValues[f.name][sheetName] = {};
        for (const [colName, data] of Object.entries(cols)) {
          flatValues[f.name][sheetName][colName] = data.values;
        }
      }
    }

    pyodide.globals.set("_config_json", JSON.stringify(msg.config));
    pyodide.globals.set("_values_json", JSON.stringify(flatValues));
    pyodide.globals.set("_existing_mapping_json", msg.existingMappingJson || "");

    const mappingJson = pyodide.runPython(
      "import json\n" +
        "from mapping import build_mapping, mapping_from_json, mapping_to_json\n" +
        "_cfg = json.loads(_config_json)\n" +
        "_vals = json.loads(_values_json)\n" +
        "_existing = mapping_from_json(_existing_mapping_json) if _existing_mapping_json else None\n" +
        "mapping_to_json(build_mapping(_cfg, _vals, _existing))"
    );
    post({ type: "mapping-result", id: msg.id, json: mappingJson });
  } catch (err) {
    post({ type: "mapping-result", id: msg.id, error: lastTracebackLine(err.message) });
  }
}

function handleMask(msg) {
  // msg: { id, name, buffer, config, mappingJson }
  // Re-read from disk (design.md §9.2, item 4) -- the buffer is already
  // fresh, main.js re-read the File rather than reusing an earlier phase's.
  const srcPath = "/tmp/mask-src-" + msg.id + "-" + msg.name;
  const outPath = "/tmp/mask-out-" + msg.id + "-" + msg.name;
  try {
    pyodide.FS.writeFile(srcPath, new Uint8Array(msg.buffer));
    pyodide.globals.set("_mask_src_path", srcPath);
    pyodide.globals.set("_mask_out_path", outPath);
    pyodide.globals.set("_mask_file_pattern", msg.name);
    pyodide.globals.set("_mask_config_json", JSON.stringify(msg.config));
    pyodide.globals.set("_mask_mapping_json", msg.mappingJson);

    const summaryJson = pyodide.runPython(
      "import json\n" +
        "_cfg = json.loads(_mask_config_json)\n" +
        "_map = mapping.mapping_from_json(_mask_mapping_json)\n" +
        "_summary = masker.mask_file(_mask_src_path, _mask_out_path, _mask_file_pattern, _cfg, _map)\n" +
        "json.dumps(_summary)"
    );

    const outBytes = pyodide.FS.readFile(outPath);
    const buffer = outBytes.buffer.slice(
      outBytes.byteOffset,
      outBytes.byteOffset + outBytes.byteLength
    );
    pyodide.FS.unlink(srcPath);
    pyodide.FS.unlink(outPath);
    post(
      { type: "mask-result", id: msg.id, name: msg.name, buffer, summary: JSON.parse(summaryJson) },
      [buffer]
    );
  } catch (err) {
    post({ type: "mask-result", id: msg.id, name: msg.name, error: lastTracebackLine(err.message) });
  }
}

function handleRestore(msg) {
  // msg: { id, name, buffer, mappingJson } -- searches for tokens in a file
  // of any supported format rather than working by column (design.md §2).
  // Unrelated to this session's mask/config -- a separate, self-contained
  // flow that needs nothing but the dictionary.
  const srcPath = "/tmp/restore-src-" + msg.id + "-" + msg.name;
  const outPath = "/tmp/restore-out-" + msg.id + "-" + msg.name;
  try {
    pyodide.FS.writeFile(srcPath, new Uint8Array(msg.buffer));
    pyodide.globals.set("_restore_src_path", srcPath);
    pyodide.globals.set("_restore_out_path", outPath);
    pyodide.globals.set("_restore_mapping_json", msg.mappingJson);

    const summaryJson = pyodide.runPython(
      "import json\n" +
        "_map = mapping.mapping_from_json(_restore_mapping_json)\n" +
        "_summary = restorer.restore_file(_restore_src_path, _restore_out_path, _map)\n" +
        "json.dumps(_summary)"
    );

    const outBytes = pyodide.FS.readFile(outPath);
    const buffer = outBytes.buffer.slice(
      outBytes.byteOffset,
      outBytes.byteOffset + outBytes.byteLength
    );
    pyodide.FS.unlink(srcPath);
    pyodide.FS.unlink(outPath);
    post(
      { type: "restore-result", id: msg.id, name: msg.name, buffer, summary: JSON.parse(summaryJson) },
      [buffer]
    );
  } catch (err) {
    post({ type: "restore-result", id: msg.id, name: msg.name, error: lastTracebackLine(err.message) });
  }
}

function handleBuildReport(msg) {
  // msg: { id, config, mappingJson, files: [{name, buffer}] }
  try {
    const filesStats = {};
    const rowCounts = {};
    for (const f of msg.files) {
      const path = "/tmp/report-" + msg.id + "-" + f.name;
      pyodide.FS.writeFile(path, new Uint8Array(f.buffer));
      pyodide.globals.set("_report_path", path);
      pyodide.globals.set("_report_file_pattern", f.name);
      pyodide.globals.set("_report_config_json", JSON.stringify(msg.config));
      const resultJson = pyodide.runPython(
        "import json\n" +
          "_cfg = json.loads(_report_config_json)\n" +
          "_sheets, _rows = report.collect_column_stats(_report_path, _report_file_pattern, _cfg)\n" +
          "json.dumps({'sheets': _sheets, 'rows': _rows})"
      );
      pyodide.FS.unlink(path);
      const parsed = JSON.parse(resultJson);
      filesStats[f.name] = parsed.sheets;
      rowCounts[f.name] = parsed.rows;
    }

    pyodide.globals.set("_report_files_stats_json", JSON.stringify(filesStats));
    pyodide.globals.set("_report_row_counts_json", JSON.stringify(rowCounts));
    pyodide.globals.set("_report_mapping_json", msg.mappingJson);
    pyodide.globals.set("_report_config_json", JSON.stringify(msg.config));

    const htmlText = pyodide.runPython(
      "import json\n" +
        "_files_stats = json.loads(_report_files_stats_json)\n" +
        "_row_counts = json.loads(_report_row_counts_json)\n" +
        "_map = mapping.mapping_from_json(_report_mapping_json)\n" +
        "_cfg = json.loads(_report_config_json)\n" +
        "_rep = report.build_report(_files_stats, _row_counts, _cfg, _map)\n" +
        "report.render_report_html(_rep)"
    );
    post({ type: "report-result", id: msg.id, html: htmlText });
  } catch (err) {
    post({ type: "report-result", id: msg.id, error: lastTracebackLine(err.message) });
  }
}

self.onmessage = (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "init":
      init();
      break;
    case "preview":
      handlePreview(msg);
      break;
    case "mask":
      handleMask(msg);
      break;
    case "restore":
      handleRestore(msg);
      break;
    case "build-report":
      handleBuildReport(msg);
      break;
    case "build-config":
      handleBuildConfig(msg);
      break;
    case "build-mapping":
      handleBuildMapping(msg);
      break;
    default:
      post({ type: "error", message: "unknown message type: " + msg.type });
  }
};
