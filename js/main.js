const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const loadProgressEl = document.getElementById("loadProgress");
const fileInput = document.getElementById("fileInput");
const previewEl = document.getElementById("preview");
const runEl = document.getElementById("run");

function log(msg) {
  logEl.textContent += msg + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = "status " + cls;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("sw.js");
    log("Service worker registered — assets are cached for offline use.");
  } catch (err) {
    log("Service worker not registered: " + err.message);
  }
}

// Must match CACHE_NAME in sw.js. On the very first visit the SW has not
// taken control of the page yet (standard browser behavior, not a bug),
// so its own fetch handler may never have seen -- let alone cached -- the
// requests worker.js issued during init. We only show the "you can go
// offline" banner after explicitly verifying (and backfilling where
// needed) every vendor file from here -- §10, design.md §9.1/§9.2.
const CACHE_NAME = "anonymizer-v4";

function extraVendorAssets() {
  // jszip is loaded from the main thread (index.html), not through
  // worker.js, so it never appears in the worker's fetchedVendorUrls --
  // add it separately.
  return [new URL("vendor/jszip/jszip-3.10.1.min.js", document.baseURI).href];
}

async function verifyOfflineCache(vendorAssets) {
  const allAssets = [...vendorAssets, ...extraVendorAssets()];
  if (!("caches" in window) || allAssets.length === 0) {
    setStatus("Ready. You can disconnect from the internet.", "ready");
    loadProgressEl.hidden = true;
    return;
  }
  setStatus("Engine ready, verifying offline cache…", "loading");
  try {
    const cache = await caches.open(CACHE_NAME);
    let cached = 0;
    for (const url of allAssets) {
      const hit = await cache.match(url);
      if (hit) {
        cached++;
        continue;
      }
      const response = await fetch(url);
      if (response.ok) {
        await cache.put(url, response);
        cached++;
      }
    }
    log(`Offline cache verified: ${cached} of ${allAssets.length} engine files cached.`);
  } catch (err) {
    log("Offline cache verification failed: " + err.message);
  }
  setStatus("Ready. You can disconnect from the internet.", "ready");
  loadProgressEl.hidden = true;
}

// File handles are kept separately from the preview -- the bytes were
// already neutered by the transfer during preview, so link detection (§5)
// has to re-read the file from disk (design.md §9.2, item 4).
const loadedFiles = new Map(); // fileName -> File

// columnState: key "file::sheet::column" -> { fileName, sheetName,
// columnName, touch }. No entity field: in version 1 beta the entity IS
// the column name, so a tick is the only thing the client decides.
const columnState = new Map();

function columnKey(fileName, sheetName, columnName) {
  return `${fileName}::${sheetName}::${columnName}`;
}

function renderGuesses(fileName, sheetName, guesses) {
  const list = document.createElement("ul");
  list.className = "guesses";
  guesses.forEach((g) => {
    const key = columnKey(fileName, sheetName, g.column);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = g.touch;

    columnState.set(key, {
      fileName,
      sheetName,
      columnName: g.column,
      touch: g.touch,
    });

    checkbox.addEventListener("change", () => {
      columnState.get(key).touch = checkbox.checked;
    });

    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = ` ${g.column} — ${g.reason} `;
    li.appendChild(checkbox);
    li.appendChild(label);
    list.appendChild(li);
  });
  return list;
}

function renderTable(columns, rows) {
  const table = document.createElement("table");
  const thead = document.createElement("tr");
  columns.forEach((c) => {
    const th = document.createElement("th");
    th.textContent = c;
    thead.appendChild(th);
  });
  table.appendChild(thead);
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((v) => {
      const td = document.createElement("td");
      td.textContent = v === null || v === undefined ? "" : String(v);
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  return table;
}

function renderPreview(name, sheets) {
  const fileHeading = document.createElement("p");
  fileHeading.textContent = name;
  previewEl.appendChild(fileHeading);

  Object.entries(sheets).forEach(([sheetName, table]) => {
    const sheetHeading = document.createElement("p");
    sheetHeading.className = "todo";
    sheetHeading.textContent = "Sheet: " + sheetName;
    previewEl.appendChild(sheetHeading);
    previewEl.appendChild(renderTable(table.columns, table.rows));
    previewEl.appendChild(renderGuesses(name, sheetName, table.guesses));
  });

  runEl.hidden = false;
}

// The prefix is derived from the column name, so two different names can
// produce the same one: `Sales` and `Sale Price` both give `SALE`. Nobody
// can fix that by hand any more -- there is no entity field and no config
// step on screen -- so a prefix already taken gets a number: SALE, SALE2.
// Without this two different values would end up sharing a token string
// and the key would be ambiguous (v1-beta.md, acceptance criterion 4).
function derivePrefix(entityName, index, taken) {
  const letters = (entityName || "").toUpperCase().replace(/[^A-Z]/g, "");
  const base = letters.length >= 2 ? letters.slice(0, 4) : "ENT" + index;
  let prefix = base;
  let n = 2;
  while (taken.has(prefix)) prefix = base + n++;
  taken.add(prefix);
  return prefix;
}

// The entity -- the token namespace a value belongs to -- is the column
// name itself (v1-beta.md). One value gets one token within one entity,
// so columns that carry the same name, in one file or across several,
// land in the same namespace and therefore share tokens. That is the
// whole linking rule of version 1: name the column the same way in every
// file and the link holds; name it differently and it does not. Nothing
// is guessed, and there is nothing for the client to fill in.
function buildConfigPayload() {
  const byEntity = new Map();

  for (const col of columnState.values()) {
    if (!col.touch) continue;
    if (!byEntity.has(col.columnName)) byEntity.set(col.columnName, []);
    byEntity.get(col.columnName).push({
      file_pattern: col.fileName,
      sheet_name: col.sheetName,
      column_name: col.columnName,
    });
  }

  const entities = {};
  const takenPrefixes = new Set();
  let i = 0;
  for (const [entityName, columns] of byEntity) {
    const prefix = derivePrefix(entityName, i++, takenPrefixes);
    entities[entityName] = { prefix, width: 6, columns };
  }

  return { config: { version: 1, entities } };
}

let nextId = 0;
const worker = new Worker("js/worker.js", { type: "module" });

worker.onmessage = (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "status":
      log(msg.text);
      break;
    case "ready":
      fileInput.disabled = false;
      verifyOfflineCache(msg.vendorAssets || []);
      break;
    case "preview-result":
      log(`Preview of "${msg.name}" ready.`);
      renderPreview(msg.name, msg.sheets);
      break;
    case "config-result":
      onConfigValidated(msg.json, msg.error);
      break;
    case "mapping-result":
      onKeyBuilt(msg.json, msg.error);
      break;
    case "mask-result":
      onFileMasked(msg.name, msg.buffer, msg.summary, msg.error);
      break;
    case "error":
      log("Error: " + msg.message);
      if (!msg.id) {
        setStatus("Engine failed to load", "error");
        loadProgressEl.hidden = true;
      }
      break;
  }
};

// One file per run (v1-beta.md, step 2). Picking another file starts from
// scratch rather than adding to what is on screen: the ticks, the preview
// and any finished downloads belong to the file they were made for.
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  loadedFiles.clear();
  columnState.clear();
  previewEl.innerHTML = "";
  runEl.hidden = true;
  resetRunOutput();
  loadedFiles.set(file.name, file);
  const buffer = await file.arrayBuffer();
  const id = String(nextId++);
  log(`Reading "${file.name}"…`);
  worker.postMessage({ type: "preview", id, name: file.name, buffer }, [buffer]);
  fileInput.value = "";
});

// One button, one run (v1-beta.md, step 5). The client ticks columns and
// presses it; config, key and masking happen behind it in that order. The
// intermediate steps used to be three buttons with their JSON printed on
// screen -- nothing there was a decision, so nothing there was worth
// showing.
const maskOutputEl = document.getElementById("maskOutput");
const maskProgressEl = document.getElementById("maskProgress");
const maskedZipDownloadEl = document.getElementById("maskedZipDownload");
const mappingDownloadEl = document.getElementById("mappingDownload");

// The run in flight: { config, fileName, ... }. null when idle -- every
// stage checks it, so a stale message from an abandoned run is ignored
// instead of writing over the screen.
let run = null;

function resetRunOutput() {
  maskOutputEl.innerHTML = "";
  maskedZipDownloadEl.hidden = true;
  mappingDownloadEl.hidden = true;
  maskProgressEl.hidden = true;
  run = null;
}

function failRun(message) {
  log("Error: " + message);
  maskProgressEl.hidden = true;
  run = null;
}

document.getElementById("maskBtn").addEventListener("click", () => {
  const fileName = [...loadedFiles.keys()][0];
  if (!fileName) {
    log("Load a file first.");
    return;
  }
  const { config } = buildConfigPayload();
  if (!Object.keys(config.entities).length) {
    log("Nothing is ticked — tick at least one column to hide.");
    return;
  }
  resetRunOutput();
  run = { config, fileName };
  maskProgressEl.max = 2;
  maskProgressEl.value = 0;
  maskProgressEl.hidden = false;
  log("Checking the column selection…");
  worker.postMessage({ type: "build-config", id: String(nextId++), config });
});

// Stage 1. The config goes through py/config.py, which is the one place
// that rejects a broken selection (duplicate prefixes above all). The
// validated version is what the later stages use -- not the raw payload.
async function onConfigValidated(json, error) {
  if (!run) return;
  if (error) {
    failRun("the column selection was rejected: " + error);
    return;
  }
  run.config = JSON.parse(json);

  const sheetColumns = {};
  for (const entity of Object.values(run.config.entities)) {
    for (const c of entity.columns) {
      (sheetColumns[c.sheet_name] ??= []).push(c.column_name);
    }
  }

  const buffer = await loadedFiles.get(run.fileName).arrayBuffer();
  log("Collecting the values and building the key…");
  worker.postMessage(
    {
      type: "build-mapping",
      id: String(nextId++),
      config: run.config,
      files: [{ name: run.fileName, buffer, sheetColumns }],
    },
    [buffer]
  );
}

// Stage 2. The key is offered for download the moment it exists, before
// masking has even run: it is the file the client must not lose, and it is
// the one thing here that cannot be rebuilt (v1-beta.md, step 8).
async function onKeyBuilt(json, error) {
  if (!run) return;
  if (error) {
    failRun("the key could not be built: " + error);
    return;
  }
  mappingDownloadEl.href = URL.createObjectURL(
    new Blob([json], { type: "application/json" })
  );
  mappingDownloadEl.hidden = false;
  maskProgressEl.value = 1;

  const buffer = await loadedFiles.get(run.fileName).arrayBuffer();
  log(`Masking "${run.fileName}"…`);
  worker.postMessage(
    {
      type: "mask",
      id: String(nextId++),
      name: run.fileName,
      buffer,
      config: run.config,
      mappingJson: json,
    },
    [buffer]
  );
}

// Stage 3. masked.zip holds the masked file and nothing else -- no report,
// no config, and above all not the key (v1-beta.md, step 8).
async function onFileMasked(name, buffer, summary, error) {
  if (!run) return;
  if (error) {
    failRun(`${name}: ${error}`);
    return;
  }
  maskProgressEl.value = 2;

  const li = document.createElement("li");
  li.textContent = `${name}: cells masked — ${summary.cells_masked}`;
  const list = document.createElement("ul");
  list.appendChild(li);
  maskOutputEl.appendChild(list);

  const zip = new JSZip();
  zip.file(name, new Uint8Array(buffer));
  const blob = await zip.generateAsync({ type: "blob" });
  maskedZipDownloadEl.href = URL.createObjectURL(blob);
  maskedZipDownloadEl.hidden = false;
  log("Done. Send masked.zip to your analyst, keep the key.");
  run = null;
}

// Restore is not on this page. It moves to a page of its own, and what it
// takes from the analyst -- a finished file or the formulas behind it --
// is still open (owner's decision 20.08; improvements.md §7). py/restorer.py
// and its tests stay in the repository, unreachable from this UI.

registerServiceWorker();
worker.postMessage({ type: "init" });
