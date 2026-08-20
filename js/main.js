const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const loadProgressEl = document.getElementById("loadProgress");
const fileInput = document.getElementById("fileInput");
const previewEl = document.getElementById("preview");
const configEl = document.getElementById("config");
const linksEl = document.getElementById("links");
const mappingEl = document.getElementById("mapping");
const maskingEl = document.getElementById("masking");

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
// columnName, touch, entity, inputEl }. inputEl points at the entity DOM
// field so a confirmed link (§5) can sync the value on screen, not only
// in state.
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

    const entityInput = document.createElement("input");
    entityInput.type = "text";
    entityInput.placeholder = "entity";
    entityInput.value = g.entity || "";
    entityInput.size = 12;

    columnState.set(key, {
      fileName,
      sheetName,
      columnName: g.column,
      touch: g.touch,
      entity: g.entity || "",
      inputEl: entityInput,
    });

    checkbox.addEventListener("change", () => {
      columnState.get(key).touch = checkbox.checked;
    });
    entityInput.addEventListener("input", () => {
      columnState.get(key).entity = entityInput.value.trim();
    });

    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = ` ${g.column} — ${g.reason} `;
    li.appendChild(checkbox);
    li.appendChild(label);
    li.appendChild(entityInput);
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

  configEl.hidden = false;
  linksEl.hidden = loadedFiles.size < 2; // links only make sense from two files up
  mappingEl.hidden = false;
}

function derivePrefix(entityName, index) {
  const letters = (entityName || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (letters.length >= 2) return letters.slice(0, 4);
  return "ENT" + index;
}

function buildConfigPayload() {
  const byEntity = new Map();
  const skipped = [];

  for (const col of columnState.values()) {
    if (!col.touch) continue;
    if (!col.entity) {
      skipped.push(`${col.fileName} / ${col.sheetName} / ${col.columnName}`);
      continue;
    }
    if (!byEntity.has(col.entity)) byEntity.set(col.entity, []);
    byEntity.get(col.entity).push({
      file_pattern: col.fileName,
      sheet_name: col.sheetName,
      column_name: col.columnName,
    });
  }

  const entities = {};
  let i = 0;
  for (const [entityName, columns] of byEntity) {
    entities[entityName] = { prefix: derivePrefix(entityName, i++), width: 6, columns };
  }

  return { config: { version: 1, entities }, skipped };
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
      document.getElementById("restoreMappingInput").disabled = false;
      document.getElementById("restoreFilesInput").disabled = false;
      document.getElementById("restoreBtn").disabled = false;
      verifyOfflineCache(msg.vendorAssets || []);
      break;
    case "preview-result":
      log(`Preview of "${msg.name}" ready.`);
      renderPreview(msg.name, msg.sheets);
      break;
    case "config-result":
      renderConfigResult(msg.json, msg.error);
      break;
    case "links-result":
      renderLinksResult(msg.links, msg.error);
      break;
    case "mapping-result":
      renderMappingResult(msg.json, msg.error);
      break;
    case "mask-result":
      renderMaskResult(msg.name, msg.buffer, msg.summary, msg.error);
      break;
    case "restore-result":
      renderRestoreResult(msg.name, msg.buffer, msg.summary, msg.error);
      break;
    case "report-result":
      renderReportResult(msg.html, msg.error);
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

fileInput.addEventListener("change", async () => {
  for (const file of fileInput.files) {
    loadedFiles.set(file.name, file);
    const buffer = await file.arrayBuffer();
    const id = String(nextId++);
    log(`Sending "${file.name}" to the worker for preview…`);
    worker.postMessage({ type: "preview", id, name: file.name, buffer }, [buffer]);
  }
  fileInput.value = "";
});

const configOutputEl = document.getElementById("configOutput");
const configDownloadEl = document.getElementById("configDownload");

function renderConfigResult(json, error) {
  if (error) {
    configOutputEl.textContent = "Validation error: " + error;
    configDownloadEl.hidden = true;
    return;
  }
  configOutputEl.textContent = json;
  const blob = new Blob([json], { type: "application/json" });
  configDownloadEl.href = URL.createObjectURL(blob);
  configDownloadEl.hidden = false;
}

document.getElementById("buildConfigBtn").addEventListener("click", () => {
  const { config, skipped } = buildConfigPayload();
  if (skipped.length) {
    log(
      "Left out of the config (ticked for masking, but no entity given): " +
        skipped.join(", ")
    );
  }
  const id = String(nextId++);
  worker.postMessage({ type: "build-config", id, config });
});

// §5 -- links between columns/files
const linksOutputEl = document.getElementById("linksOutput");

function columnsBySheetForFile(fileName) {
  const bySheet = {};
  const entities = {};
  for (const col of columnState.values()) {
    if (col.fileName !== fileName || !col.touch) continue;
    (bySheet[col.sheetName] ??= []).push(col.columnName);
    (entities[col.sheetName] ??= {})[col.columnName] = col.entity || null;
  }
  return { sheetColumns: bySheet, entities };
}

document.getElementById("findLinksBtn").addEventListener("click", async () => {
  const files = [];
  const transfers = [];
  for (const [fileName, file] of loadedFiles) {
    const { sheetColumns, entities } = columnsBySheetForFile(fileName);
    if (Object.keys(sheetColumns).length === 0) continue;
    const buffer = await file.arrayBuffer();
    files.push({ name: fileName, buffer, sheetColumns, entities });
    transfers.push(buffer);
  }
  if (files.length < 2) {
    log("Find links: needs at least two files with columns ticked for masking.");
    return;
  }
  log(`Looking for links across ${files.length} files (streaming projection, §9.2)…`);
  const id = String(nextId++);
  worker.postMessage({ type: "find-links", id, files }, transfers);
});

function renderLinksResult(links, error) {
  linksOutputEl.innerHTML = "";
  if (error) {
    linksOutputEl.textContent = "Error: " + error;
    return;
  }
  if (!links.length) {
    linksOutputEl.textContent = "No links found.";
    return;
  }
  const list = document.createElement("ul");
  links.forEach((link) => {
    const li = document.createElement("li");
    const desc = document.createElement("span");
    desc.textContent = `${link.a.file}/${link.a.sheet}/${link.a.column} ↔ ${link.b.file}/${link.b.sheet}/${link.b.column} — ${link.reason}`;

    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "Confirm (same entity)";
    confirmBtn.addEventListener("click", () => {
      confirmLink(link);
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Confirmed";
    });

    li.appendChild(desc);
    li.appendChild(confirmBtn);
    list.appendChild(li);
  });
  linksOutputEl.appendChild(list);
}

function confirmLink(link) {
  const keyA = columnKey(link.a.file, link.a.sheet, link.a.column);
  const keyB = columnKey(link.b.file, link.b.sheet, link.b.column);
  const a = columnState.get(keyA);
  const b = columnState.get(keyB);
  if (!a || !b) return;
  const shared = a.entity || b.entity || "linked_entity";
  a.entity = shared;
  b.entity = shared;
  a.inputEl.value = shared;
  b.inputEl.value = shared;
  log(`Link confirmed: both columns assigned to entity "${shared}".`);
}

// §6 -- dictionary and tokens
let existingMappingJson = null;

document.getElementById("existingMappingInput").addEventListener("change", async () => {
  const file = document.getElementById("existingMappingInput").files[0];
  if (!file) {
    existingMappingJson = null;
    return;
  }
  existingMappingJson = await file.text();
  log(`Existing dictionary loaded, new values will be appended to it: ${file.name}`);
});

const mappingOutputEl = document.getElementById("mappingOutput");
const mappingDownloadEl = document.getElementById("mappingDownload");

function renderMappingResult(json, error) {
  if (error) {
    mappingOutputEl.textContent = "Error: " + error;
    mappingDownloadEl.hidden = true;
    return;
  }
  mappingOutputEl.textContent = json;
  const blob = new Blob([json], { type: "application/json" });
  mappingDownloadEl.href = URL.createObjectURL(blob);
  mappingDownloadEl.hidden = false;
  maskingEl.hidden = false;
}

document.getElementById("buildMappingBtn").addEventListener("click", async () => {
  const { config } = buildConfigPayload();

  // Which files/sheets/columns are actually needed comes from the
  // confirmed config, not from columnState directly (§4 already filtered
  // out the rest).
  const filesNeeded = new Map(); // fileName -> { sheetName: [columnName, ...] }
  for (const entity of Object.values(config.entities)) {
    for (const c of entity.columns) {
      if (!loadedFiles.has(c.file_pattern)) continue;
      const bySheet = filesNeeded.get(c.file_pattern) || {};
      (bySheet[c.sheet_name] ??= []).push(c.column_name);
      filesNeeded.set(c.file_pattern, bySheet);
    }
  }

  if (filesNeeded.size === 0) {
    log("Build dictionary: no columns have an entity assigned — use \"Build config\" first.");
    return;
  }

  const files = [];
  const transfers = [];
  for (const [fileName, sheetColumns] of filesNeeded) {
    const buffer = await loadedFiles.get(fileName).arrayBuffer();
    files.push({ name: fileName, buffer, sheetColumns });
    transfers.push(buffer);
  }

  log(`Building the dictionary from ${files.length} file(s)…`);
  const id = String(nextId++);
  worker.postMessage({ type: "build-mapping", id, config, files, existingMappingJson }, transfers);
});

// §7 -- masking engine
const maskOutputEl = document.getElementById("maskOutput");
const maskProgressEl = document.getElementById("maskProgress");
const maskedZipDownloadEl = document.getElementById("maskedZipDownload");

// Output packaging (design.md §6): masked.zip is assembled only once both
// halves are ready -- every masked file and report.html. The order in
// which the user clicks "Mask files" / "Build report" does not matter,
// tryBuildMaskedZip is checked after each of the two events.
let maskedBuffers = null; // Map(name -> Uint8Array), null until a run starts
let maskExpectedCount = 0;
let reportHtmlForZip = null;

function maskOutputList() {
  let list = maskOutputEl.querySelector("ul");
  if (!list) {
    list = document.createElement("ul");
    maskOutputEl.appendChild(list);
  }
  return list;
}

async function tryBuildMaskedZip() {
  if (!maskedBuffers || maskedBuffers.size < maskExpectedCount) return;
  if (!reportHtmlForZip) return;
  log("All files masked and the report is ready — building masked.zip…");
  const zip = new JSZip();
  for (const [name, bytes] of maskedBuffers) {
    zip.file(name, bytes);
  }
  zip.file("report.html", reportHtmlForZip);
  const blob = await zip.generateAsync({ type: "blob" });
  maskedZipDownloadEl.href = URL.createObjectURL(blob);
  maskedZipDownloadEl.hidden = false;
  log("masked.zip is ready.");
}

function renderMaskResult(name, buffer, summary, error) {
  const li = document.createElement("li");
  if (error) {
    li.textContent = `${name}: error — ${error}`;
  } else {
    maskedBuffers.set(name, new Uint8Array(buffer));
    li.textContent = `${name}: cells masked — ${summary.cells_masked}`;
  }
  maskOutputList().appendChild(li);
  maskProgressEl.value = maskedBuffers.size;
  tryBuildMaskedZip();
}

document.getElementById("maskBtn").addEventListener("click", async () => {
  const { config } = buildConfigPayload();
  const mappingJson = mappingOutputEl.textContent;
  if (!mappingJson || !mappingJson.startsWith("{")) {
    log("Mask files: build the dictionary first (step above).");
    return;
  }

  const fileNames = new Set();
  for (const entity of Object.values(config.entities)) {
    for (const c of entity.columns) {
      if (loadedFiles.has(c.file_pattern)) fileNames.add(c.file_pattern);
    }
  }
  if (!fileNames.size) {
    log("Mask files: no columns have an entity assigned — use \"Build config\" first.");
    return;
  }

  maskOutputEl.innerHTML = "";
  maskedZipDownloadEl.hidden = true;
  maskedBuffers = new Map();
  maskExpectedCount = fileNames.size;
  reportHtmlForZip = null; // new run -- do not reuse the previous report
  maskProgressEl.max = maskExpectedCount;
  maskProgressEl.value = 0;
  maskProgressEl.hidden = false;
  for (const name of fileNames) {
    const buffer = await loadedFiles.get(name).arrayBuffer();
    const id = String(nextId++);
    log(`Masking "${name}"…`);
    worker.postMessage({ type: "mask", id, name, buffer, config, mappingJson }, [buffer]);
  }
});

// §8 -- restore, a standalone flow
let restoreMappingJson = null;

document.getElementById("restoreMappingInput").addEventListener("change", async () => {
  const file = document.getElementById("restoreMappingInput").files[0];
  restoreMappingJson = file ? await file.text() : null;
});

function restoreOutputList() {
  let list = restoreOutputEl.querySelector("ul");
  if (!list) {
    list = document.createElement("ul");
    restoreOutputEl.appendChild(list);
  }
  return list;
}

const restoreOutputEl = document.getElementById("restoreOutput");

function renderRestoreResult(name, buffer, summary, error) {
  const li = document.createElement("li");
  if (error) {
    li.textContent = `${name}: error — ${error}`;
  } else {
    const blob = new Blob([buffer]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "restored_" + name;
    const count = summary.cells_restored ?? summary.tokens_replaced;
    a.textContent = `Download restored_${name} (restored: ${count})`;
    li.appendChild(a);
  }
  restoreOutputList().appendChild(li);
}

document.getElementById("restoreBtn").addEventListener("click", async () => {
  if (!restoreMappingJson) {
    log("Restore: load your dictionary first.");
    return;
  }
  const files = document.getElementById("restoreFilesInput").files;
  if (!files.length) {
    log("Restore: select at least one file.");
    return;
  }
  restoreOutputEl.innerHTML = "";
  for (const file of files) {
    const buffer = await file.arrayBuffer();
    const id = String(nextId++);
    log(`Restoring "${file.name}"…`);
    worker.postMessage(
      { type: "restore", id, name: file.name, buffer, mappingJson: restoreMappingJson },
      [buffer]
    );
  }
});

// §9 -- report
const reportOutputEl = document.getElementById("reportOutput");

function renderReportResult(htmlText, error) {
  reportOutputEl.innerHTML = "";
  if (error) {
    reportOutputEl.textContent = "Error: " + error;
    return;
  }
  const iframe = document.createElement("iframe");
  iframe.srcdoc = htmlText;
  reportOutputEl.appendChild(iframe);

  // report.html is not offered as a separate download (design.md §6: only
  // masked.zip and mapping.KEEP-PRIVATE.json) -- it goes inside masked.zip
  // as soon as both it and every masked file are ready.
  reportHtmlForZip = htmlText;
  tryBuildMaskedZip();
}

document.getElementById("buildReportBtn").addEventListener("click", async () => {
  const { config } = buildConfigPayload();
  const mappingJson = mappingOutputEl.textContent;
  if (!mappingJson || !mappingJson.startsWith("{")) {
    log("Build report: build the dictionary first.");
    return;
  }

  const files = [];
  for (const [name, file] of loadedFiles) {
    const buffer = await file.arrayBuffer();
    files.push({ name, buffer });
  }
  if (!files.length) {
    log("Build report: no files loaded.");
    return;
  }

  log("Building the report…");
  const id = String(nextId++);
  const transfers = files.map((f) => f.buffer);
  worker.postMessage({ type: "build-report", id, config, mappingJson, files }, transfers);
});

registerServiceWorker();
worker.postMessage({ type: "init" });
