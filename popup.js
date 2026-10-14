// popup.js — UGLab Popup Controller

// SF Symbols-style monoline icons (24px grid, rounded caps), coloured by currentColor.
const ICONS = {
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l3 3M14 9l2 2"/>',
  coffee: '<path d="M5 9h11v5a5 5 0 01-5 5h-1a5 5 0 01-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 010 5H16M8.5 3.5v2M12 3.5v2"/>',
  chevron: '<path d="M9.5 5.5l6.5 6.5-6.5 6.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  pencil: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/><path d="M14.5 6.5l3 3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  "eye-off": '<path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.7A16.6 16.6 0 002 12s3.6 7 10 7a9.6 9.6 0 004.2-1M9.9 9.9a3 3 0 004.2 4.2"/>',
  save: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16v4M17 18h4"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 4v7h-7"/>',
  spinner: '<path d="M12 3a9 9 0 109 9"/>',
  xmark: '<path d="M6 6l12 12M18 6L6 18"/>',
  warning: '<path d="M12 4l9.5 16h-19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  list: '<path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01"/>',
};
const icon = (name, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const hydrateIcons = () => document.querySelectorAll("i[data-icon]").forEach(el => { el.innerHTML = icon(el.dataset.icon); });

const LMS_PATTERNS = [
  "ujian.gunadarma.ac.id",
  "praktikum.gunadarma.ac.id",
  "v-class.gunadarma.ac.id",
  "elearning.gunadarma.ac.id",
  "colab.research.google.com",
  "colab.google",
  "jupyter.org",
  "localhost"
];

let currentTabId = null;
let detectedQuestions = [];
let isRunning = false;
let logVisible = false;

// ─── DOM ─────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const statusBar = $("statusBar");
const statusText = $("statusText");
const btnStart = $("btnStart");
const btnScan = $("btnScan");
const btnIcon = $("btnIcon");
const btnText = $("btnText");
const extraPrompt = $("extraPrompt");
const charCount = $("charCount");
const progressWrap = $("progressWrap");
const logSection = $("logSection");
const logBox = $("logBox");
const logToggle = $("logToggle");
const btnClear = $("btnClear");
const statsSection = $("statsSection");
const typesSection = $("typesSection");
const notOnLmsNotice = $("notOnLmsNotice");
const qTypesContainer = $("qTypesContainer");

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  hydrateIcons();
  setupListeners();
  await detectCurrentTab();
  // the service worker keeps running when this popup is closed: pick the run state back up on reopen
  chrome.storage.local.get("prelab_run_state", (res) => applyRunState(res.prelab_run_state, true));
  chrome.storage.onChanged.addListener((ch) => { if (ch.prelab_run_state) applyRunState(ch.prelab_run_state.newValue, false); });
});

function applyRunState(rs, onLoad) {
  if (!rs || Date.now() - rs.ts > 10 * 60 * 1000) return;
  if (rs.state === "running") { isRunning = true; setBtnLoading(true); showProgress(true); setStatus("active", rs.text); }
  else if (rs.state === "done") { if (isRunning) onCompleted(Number(rs.text)); else if (onLoad && Date.now() - rs.ts < 2 * 60 * 1000) setStatus("success", `Selesai! ${rs.text} soal terjawab`); }
  else if (rs.state === "error" && (isRunning || onLoad)) { setStatus("error", "Error: " + rs.text); resetState(); }
}

function setupListeners() {
  extraPrompt.addEventListener("input", () => {
    charCount.textContent = `${extraPrompt.value.length}/500`;
  });

  btnStart.addEventListener("click", startAutoAnswer);
  btnScan.addEventListener("click", scanQuestions);
  btnClear.addEventListener("click", clearCache);
  logToggle.addEventListener("click", toggleLog);

  // Mode Toggles
  const modeAPI = $("mode-api");
  const modeWeb = $("mode-web");
  const toggleLoop = $("toggle-loop");
  const loopIndicator = $("loop-state-indicator");
  const webEngineWrap = $("webEngineWrap");
  const webGemini = $("web-gemini");
  const webChatGPT = $("web-chatgpt");
  const webClaude = $("web-claude");

  // API Config Elements
  const apiConfigWrap = $("apiConfigWrap");
  const inputApiKey = $("inputApiKey");
  const btnToggleKeyVisibility = $("btnToggleKeyVisibility");
  const apiKeyStatus = $("apiKeyStatus");

  // Credentials (API Mode only works once saved)
  const inputApiEndpoint = $("inputApiEndpoint");
  const inputApiModel = $("inputApiModel");
  const setKeyStatus = (saved) => {
    apiKeyStatus.textContent = saved ? "Tersimpan" : "Belum disimpan";
    apiKeyStatus.classList.toggle("saved", saved);
  };
  const credsBox = $("apiConfigWrap");
  const showSaved = (saved) => { credsBox.classList.toggle("creds-saved", saved); setKeyStatus(saved); };
  chrome.storage.local.get(["prelab_api_keys", "prelab_api_endpoint", "prelab_api_model", "prelab_creds_saved"], (res) => {
    inputApiKey.value = res.prelab_api_keys || "";
    inputApiEndpoint.value = res.prelab_api_endpoint || "";
    inputApiModel.value = res.prelab_api_model || "";
    showSaved(!!res.prelab_creds_saved);
    requestAnimationFrame(() => requestAnimationFrame(() => credsBox.classList.remove("no-anim"))); // no animation on popup open
  });
  $("btnEditCreds").addEventListener("click", () => { credsBox.classList.remove("creds-saved"); setKeyStatus(false); });
  [inputApiKey, inputApiEndpoint, inputApiModel].forEach(el => el.addEventListener("input", () => setKeyStatus(false)));

  $("btnSaveCreds").addEventListener("click", () => {
    const key = inputApiKey.value.trim();
    const endpoint = inputApiEndpoint.value.trim();
    const model = inputApiModel.value.trim();
    if (!key || !model || !/^https?:\/\//i.test(endpoint)) {
      setStatus("error", "Isi endpoint (http/https), API Key, dan Model terlebih dahulu.");
      return;
    }
    // Chrome closes this popup while its permission dialog is open, so a save placed in the dialog's callback never runs:
    // store first, then ask (both inside the click gesture). Denial rolls the flag back; background re-checks the grant before every call.
    const u = new URL(endpoint); // match patterns take no port
    chrome.storage.local.set({
      prelab_api_keys: key,
      prelab_api_endpoint: endpoint,
      prelab_api_model: model,
      prelab_creds_saved: true,
    });
    chrome.permissions.request({ origins: [`${u.protocol}//${u.hostname}/*`] }, (granted) => {
      if (!granted) { chrome.storage.local.set({ prelab_creds_saved: false }); showSaved(false); setStatus("error", "Izin akses ke endpoint ditolak. API Mode tidak aktif."); return; }
      showSaved(true); setStatus("success", "Credentials tersimpan. API Mode siap dipakai.");
    });
  });

  // Toggle API Key visibility
  btnToggleKeyVisibility?.addEventListener("click", () => {
    if (inputApiKey.type === "password") {
      inputApiKey.type = "text";
      btnToggleKeyVisibility.innerHTML = icon("eye-off");
    } else {
      inputApiKey.type = "password";
      btnToggleKeyVisibility.innerHTML = icon("eye");
    }
  });

  // Load initial loop state
  chrome.storage.local.get("prelab_auto_loop", (res) => {
    if (res.prelab_auto_loop) {
      if (toggleLoop) toggleLoop.classList.add("active");
      if (toggleLoop) toggleLoop.style.borderColor = "var(--green)";
      if (loopIndicator) loopIndicator.style.background = "var(--green)";
    }
  });

  toggleLoop?.addEventListener("click", () => {
    const isActive = toggleLoop.classList.toggle("active");
    chrome.storage.local.set({ prelab_auto_loop: isActive });
    
    toggleLoop.style.borderColor = isActive ? "var(--green)" : "var(--border)";
    loopIndicator.style.background = isActive ? "var(--green)" : "#444";
    
    if (isActive) {
      setStatus("success", "Loop Mode Aktif: Sistem akan menjawab kuis secara otomatis hingga selesai.");
    }
  });
  
  [modeAPI, modeWeb].forEach(el => {
    el?.addEventListener("click", () => {
      [modeAPI, modeWeb].forEach(m => m?.classList.remove("active"));
      el.classList.add("active");
      chrome.storage.local.set({ prelab_run_mode: el.dataset.mode });
      log("info", `Mode diganti ke: ${el.dataset.mode.toUpperCase()}`);
      
      if (el.dataset.mode === "web") {
        webEngineWrap?.classList.add("visible");
        apiConfigWrap?.classList.remove("visible");
      } else {
        webEngineWrap?.classList.remove("visible");
        apiConfigWrap?.classList.add("visible");
      }
    });
  });

  [webGemini, webChatGPT, webClaude].forEach(el => {
    el?.addEventListener("click", () => {
      [webGemini, webChatGPT, webClaude].forEach(m => m?.classList.remove("active"));
      el.classList.add("active");
      modeAPI?.classList.remove("active");
      modeWeb?.classList.add("active");
      chrome.storage.local.set({ prelab_web_engine: el.dataset.engine, prelab_run_mode: "web" });
      log("info", `Web Engine diganti ke: ${el.dataset.engine.toUpperCase()}`);
    });
  });

  // Load saved mode
  chrome.storage.local.get(["prelab_run_mode", "prelab_web_engine"], (res) => {
    if (res.prelab_run_mode === "web") {
      modeAPI?.classList.remove("active");
      modeWeb?.classList.add("active");
      webEngineWrap?.classList.add("visible");
      apiConfigWrap?.classList.remove("visible");
    } else {
      modeAPI?.classList.add("active");
      modeWeb?.classList.remove("active");
      webEngineWrap?.classList.remove("visible");
      apiConfigWrap?.classList.add("visible");
    }
    
    [webGemini, webChatGPT, webClaude].forEach(m => m?.classList.remove("active"));
    if (res.prelab_web_engine === "chatgpt") {
      webChatGPT?.classList.add("active");
    } else if (res.prelab_web_engine === "claude") {
      webClaude?.classList.add("active");
    } else {
      webGemini?.classList.add("active");
    }
  });
}

// ─── Tab Detection ────────────────────────────────────────────────────────────
async function detectCurrentTab() {
  setStatus("loading", "Mendeteksi halaman...");

  try {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.startsWith("chrome-extension://")) {
      const allTabs = await chrome.tabs.query({});
      const lmsTab = allTabs.find(t => !t.url?.startsWith("chrome-extension://") && (t.url?.includes("colab.") || t.url?.includes("gunadarma.ac.id") || t.url?.includes("jupyter") || (t.url?.includes("localhost") && (t.url?.includes(":8888") || t.url?.includes("/lab")))));
      if (lmsTab) tab = lmsTab;
    }
    if (!tab) { setStatus("error", "Tidak ada tab aktif"); return; }

    currentTabId = tab.id;
    const isLMS = LMS_PATTERNS.some(p => tab.url?.includes(p));

    if (!isLMS) {
      setStatus("idle", "Bukan halaman LMS Gunadarma");
      notOnLmsNotice.style.display = "flex";
      btnStart.disabled = true;
      return;
    }

    notOnLmsNotice.style.display = "none";
    setStatus("active", "Terhubung ke LMS");
    await scanQuestions();
  } catch (err) {
    setStatus("error", "Error: " + err.message);
    log("err", "Tab detection error: " + err.message);
  }
}

// ─── Scan Questions ───────────────────────────────────────────────────────────
async function scanQuestions() {
  if (!currentTabId) return;
  setStatus("active", "Memindai soal...");
  btnScan.disabled = true;

  try {
    let res = null;
    let [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.url?.startsWith("chrome-extension://") && currentTabId) {
      activeTab = await chrome.tabs.get(currentTabId).catch(() => activeTab);
    }
    const isNotebook = activeTab?.url?.includes("colab.") || activeTab?.url?.includes("jupyter");
    if (!isNotebook) {
      try {
        res = await chrome.tabs.sendMessage(currentTabId, { type: "PRELAB_SCRAPE" });
      } catch { }
    }
    if (!res) {
      // Fallback or Notebook MAIN world execution
      const [execRes] = await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        world: "MAIN",
        func: () => {
          let globalCtx = "";
          const nb = window.colab?.global?.notebook;
          if (nb?.cells) {
            nb.cells.forEach(c => {
              if (c.model?.type === "markdown" || c.model?.type === "text") {
                const t = (c.model?.getText() || "").trim();
                if (t.includes("Instruksi") || t.includes("Overview") || t.includes("Petunjuk") || t.includes("http")) {
                  globalCtx += t.slice(0, 800) + "\n\n";
                }
              }
            });
            let qIndex = 0; const qs = [];
            nb.cells.forEach((cell, idx) => {
              if (cell.model?.type !== "code") return;
              const text = (cell.model.getText() || "").trim();
              if (text.includes("# CODE HERE") || text.includes("<...>") || text.includes("# ...")) {
                let ctx = "";
                for (let p = Math.max(0, idx - 2); p < idx; p++) {
                  const prev = (nb.cells[p]?.model?.getText() || "").trim();
                  if (prev && !prev.includes("# CODE HERE")) ctx += prev.slice(0, 300) + "\n";
                }
                qs.push({
                  index: qIndex++,
                  cellId: cell.cellId || cell.id,
                  type: "coding",
                  globalContext: globalCtx.trim(),
                  text: `${globalCtx ? `[Petunjuk & Modul]:\n${globalCtx.trim()}\n\n` : ""}[Konteks Modul]:\n${ctx}\n\n[Kode Soal]:\n${text}`,
                  rawCode: text
                });
              }
            });
            return qs;
          }

          if (typeof window.Jupyter !== "undefined" && window.Jupyter.notebook?.get_cells) {
            document.querySelectorAll(".jp-MarkdownCell, .cell.text").forEach(c => {
              const t = (c.innerText || "").trim();
              if (t.includes("Instruksi") || t.includes("Overview") || t.includes("Petunjuk") || t.includes("http")) {
                globalCtx += t.slice(0, 800) + "\n\n";
              }
            });
            let qIndex = 0; const qs = [];
            const jCells = window.Jupyter.notebook.get_cells();
            jCells.forEach((c, idx) => {
              if (c.cell_type !== "code") return;
              const text = (c.get_text() || "").trim();
              if (text.includes("# CODE HERE") || text.includes("<...>") || text.includes("# ...")) {
                let ctx = "";
                for (let p = Math.max(0, idx - 2); p < idx; p++) {
                  const prev = (jCells[p]?.get_text() || "").trim();
                  if (prev && !prev.includes("# CODE HERE")) ctx += prev.slice(0, 300) + "\n";
                }
                qs.push({
                  index: qIndex++,
                  type: "coding",
                  globalContext: globalCtx.trim(),
                  text: `${globalCtx ? `[Petunjuk & Modul]:\n${globalCtx.trim()}\n\n` : ""}[Konteks Modul]:\n${ctx}\n\n[Kode Soal]:\n${text}`,
                  rawCode: text
                });
              }
            });
            if (qs.length) return qs;
          }

          // JupyterLab/Notebook 7 only keeps editors for cells near the viewport in the DOM, so cells further down looked empty
          // and were never found. When the app is exposed (src/jupyter-expose.js) read every cell from the notebook model instead.
          const jw = window.jupyterapp?.shell?.currentWidget?.content?.widgets;
          if (jw) {
            const src = jw.map(w => ({ type: w.model.type, text: w.model.sharedModel.getSource() }));
            src.forEach(c => {
              if (c.type === "markdown" && (c.text.includes("Instruksi") || c.text.includes("Overview") || c.text.includes("Petunjuk") || c.text.includes("http"))) globalCtx += c.text.slice(0, 800) + "\n\n";
            });
            let qIndex = 0; const qs = [];
            src.forEach((c, idx) => {
              if (c.type !== "code") return;
              const text = c.text.trim();
              if (text.includes("# CODE HERE") || text.includes("<...>") || text.includes("# ...")) {
                let ctx = "";
                for (let p = Math.max(0, idx - 2); p < idx; p++) {
                  const prev = src[p].text.trim();
                  if (prev && !prev.includes("# CODE HERE")) ctx += prev.slice(0, 300) + "\n";
                }
                qs.push({
                  index: qIndex++,
                  type: "coding",
                  globalContext: globalCtx.trim(),
                  text: `${globalCtx ? `[Petunjuk & Modul]:\n${globalCtx.trim()}\n\n` : ""}[Konteks Modul]:\n${ctx}\n\n[Kode Soal]:\n${text}`,
                  rawCode: text
                });
              }
            });
            if (qs.length) return qs;
          }

          const jpCells = Array.from(document.querySelectorAll('.jp-CodeCell, .jp-Cell'));
          if (jpCells.length) {
            document.querySelectorAll(".jp-MarkdownCell, .cell.text").forEach(c => {
              const t = (c.innerText || "").trim();
              if (t.includes("Instruksi") || t.includes("Overview") || t.includes("Petunjuk") || t.includes("http")) {
                globalCtx += t.slice(0, 800) + "\n\n";
              }
            });
            let qIndex = 0; const qs = [];
            jpCells.forEach((cell, idx) => {
              const cm = cell.querySelector('.cm-content');
              const text = (cm?.cmView?.view?.state?.doc?.toString() || cm?.innerText || cell.innerText || "").trim();
              if (text.includes("# CODE HERE") || text.includes("<...>") || text.includes("# ...")) {
                let ctx = "";
                for (let p = Math.max(0, idx - 2); p < idx; p++) {
                  const prev = (jpCells[p]?.querySelector('.cm-content')?.innerText || jpCells[p]?.innerText || "").trim();
                  if (prev && !prev.includes("# CODE HERE")) ctx += prev.slice(0, 300) + "\n";
                }
                qs.push({
                  index: qIndex++,
                  type: "coding",
                  globalContext: globalCtx.trim(),
                  text: `${globalCtx ? `[Petunjuk & Modul]:\n${globalCtx.trim()}\n\n` : ""}[Konteks Modul]:\n${ctx}\n\n[Kode Soal]:\n${text}`,
                  rawCode: text
                });
              }
            });
            if (qs.length) return qs;
          }

          return null;
        }
      });
      if (execRes?.result?.length) {
        await chrome.storage.local.set({ prelab_questions_cache: execRes.result });
        res = { questions: execRes.result.map(q => ({ index: q.index, type: q.type, text: q.text.slice(0, 100), hasImages: false })), count: execRes.result.length };
      }
    }

    if (res?.questions && res.questions.length > 0) {
      detectedQuestions = res.questions;
      updateStats(detectedQuestions);
      setStatus("success", `${detectedQuestions.length} soal ditemukan`);
      btnStart.disabled = false;
      log("ok", `Scan selesai: ${detectedQuestions.length} soal`);
    } else {
      detectedQuestions = [];
      updateStats([]);
      setStatus("idle", "Tidak ada soal ditemukan di halaman ini");
      btnStart.disabled = true;
      log("info", "Tidak ada soal ditemukan. Coba buka halaman kuis.");
    }
  } catch (err) {
    setStatus("error", "Gagal scan soal");
    log("err", "Scan error: " + err.message);
    btnStart.disabled = true;
  } finally {
    btnScan.disabled = false;
  }
}

// ─── Clear Cache ────────────────────────────────────────────────────
async function clearCache() {
  const CACHE_KEYS = [
    "prelab_questions_cache",
    "prelab_pending_payload",
    "prelab_pending_meta",
    "prelab_answers_pending",
  ];
  await chrome.storage.local.remove(CACHE_KEYS);
  detectedQuestions = [];
  isRunning = false;
  setBtnLoading(false);
  showProgress(false);
  updateStats([]);
  setStatus("idle", "Cache dibersihkan — siap digunakan kembali");
  log("ok", "Cache dihapus: questions, payload, pending answers.");
  btnStart.disabled = true;
}

// ─── Update Stats UI ──────────────────────────────────────────────────────────
function updateStats(questions) {
  if (!questions.length) {
    statsSection.style.display = "none";
    typesSection.style.display = "none";
    return;
  }

  statsSection.style.display = "block";
  typesSection.style.display = "block";

  $("statTotal").textContent = questions.length;
  $("statAnswered").textContent = "0";
  $("statPending").textContent = questions.length;

  // Count types
  const typeCounts = {};
  const typeLabels = {
    multichoice: "PG",
    truefalse: "T/F",
    multianswer: "Multi",
    shortanswer: "Isian",
    gapfiller: "Gap",
    essay: "Essay",
    coding: "Kode",
    multifill: "Kotak",
    match: "Jodoh",
  };

  questions.forEach(q => {
    typeCounts[q.type] = (typeCounts[q.type] || 0) + 1;
  });

  qTypesContainer.innerHTML = "";
  Object.entries(typeCounts).forEach(([type, count]) => {
    const chip = document.createElement("div");
    chip.className = "q-type-chip found";
    chip.textContent = `${typeLabels[type] || type} ×${count}`;
    qTypesContainer.appendChild(chip);
  });
}

// ─── Start Auto Answer ────────────────────────────────────────────────────────
async function startAutoAnswer() {
  if (isRunning || !detectedQuestions.length || !currentTabId) return;

  isRunning = true;
  setBtnLoading(true);

  const modeRes = await chrome.storage.local.get(["prelab_run_mode", "prelab_web_engine", "prelab_api_keys", "prelab_api_endpoint", "prelab_creds_saved"]);
  const mode = $("mode-web")?.classList.contains("active") ? "web" : (modeRes.prelab_run_mode || "api");
  const webEngine = $("web-chatgpt")?.classList.contains("active") ? "chatgpt" : ($("web-claude")?.classList.contains("active") ? "claude" : (modeRes.prelab_web_engine || "gemini"));
  const isWeb = mode === "web";
  const webEngineName = webEngine === "chatgpt" ? "ChatGPT Web" : webEngine === "claude" ? "Claude Web" : "Gemini Web";

  const hasImages = detectedQuestions.some(q => q.hasImages);
  const modelName = (await chrome.storage.local.get("prelab_api_model")).prelab_api_model;
  const engineLabelEl = document.getElementById("engineLabel");
  const engineModelEl = document.getElementById("engineModel");
  const engineName = isWeb ? webEngineName : "API Mode";

  if (engineLabelEl) engineLabelEl.textContent = engineName;
  if (engineModelEl) engineModelEl.textContent = isWeb ? (webEngine === "chatgpt" ? "GPT-4o" : "Gemini 2.5") : (modelName || "API");

  setStatus("active", `Mengirim ke ${engineName}...`);
  showProgress(true);
  log("info", "Memulai proses auto-jawab...");
  log("info", `Routing: ${detectedQuestions.length} soal → ${engineName}`);

  try {
    const apiKeys = (modeRes.prelab_api_keys || "").trim();

    if (mode === "api" && !(modeRes.prelab_creds_saved && apiKeys && modeRes.prelab_api_endpoint)) {
      setStatus("error", "Simpan endpoint & API Key dulu (tombol Simpan Credentials).");
      log("err", "API Mode belum aktif: credentials belum disimpan.");
      if (inputApiKey) {
        inputApiKey.focus();
        inputApiKey.style.borderColor = "var(--error)";
        setTimeout(() => { inputApiKey.style.borderColor = ""; }, 2500);
      }
      resetState();
      return;
    }

    // Persist mode & extraPrompt so loop continuation pages reuse the same instruction
    await chrome.storage.local.set({ prelab_run_mode: mode, prelab_web_engine: webEngine, prelab_extra_prompt: extraPrompt.value.trim() });

    const res = await chrome.runtime.sendMessage({
      type: "PRELAB_START",
      mode: mode,
      webEngine: webEngine,
      extraPrompt: extraPrompt.value.trim(),
      lmsTabId: currentTabId,
    });

    if (res?.ok) {
      if (mode === "web") {
        setStatus("active", `Dilempar ke ${webEngineName}...`);
        log("ok", `Membuka ${webEngine === "chatgpt" ? "chatgpt.com" : webEngine === "claude" ? "claude.ai" : "gemini.google.com"}...`);
      } else {
        setStatus("active", `${engineName} sedang memproses...`);
        log("ok", `Request dikirim ke ${engineName} (API Mode)`);
      }
      log("info", "Menunggu respons...");
      waitForCompletion();
    } else {
      throw new Error(res?.error || "Gagal mengirim ke background");
    }
  } catch (err) {
    setStatus("error", "Error: " + err.message);
    log("err", "Gagal start: " + err.message);
    resetState();
  }
}

// ─── Wait for Completion ──────────────────────────────────────────────────────
function waitForCompletion() {
  // Poll for completion by checking LMS tab
  let polls = 0;
  const poll = setInterval(async () => {
    polls++;
    if (polls > 120) { // 120s timeout
      clearInterval(poll);
      setStatus("error", "Timeout: AI tidak merespon");
      log("err", "Timeout 120 detik. Periksa endpoint / koneksi AI.");
      resetState();
    }

    // Check if answered (LMS content script would have received PRELAB_ANSWERS)
    try {
      const res = await chrome.tabs.sendMessage(currentTabId, { type: "PRELAB_PING" });
      if (res?.answered) {
        clearInterval(poll);
        onCompleted(res.answered);
      }
    } catch {}
  }, 1000);

  // Listen for direct message from LMS content
  chrome.runtime.onMessage.addListener(function handler(msg) {
    if (msg.type === "PRELAB_POPUP_DONE") {
      chrome.runtime.onMessage.removeListener(handler);
      onCompleted(msg.count);
    }
    if (msg.type === "PRELAB_POPUP_ERROR") {
      chrome.runtime.onMessage.removeListener(handler);
      setStatus("error", "Error: " + msg.error);
      log("err", msg.error);
      resetState();
    }
  });
}

function onCompleted(count) {
  setStatus("success", `Selesai! ${count || "Semua"} soal terjawab`);
  log("ok", `Auto-jawab selesai. ${count || detectedQuestions.length} jawaban terisi.`);
  $("statAnswered").textContent = count || detectedQuestions.length;
  $("statPending").textContent = 0;
  showProgress(false);
  setBtnLoading(false);
  isRunning = false;
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function setStatus(type, text) {
  statusBar.className = "status-bar " + type;
  statusText.textContent = text;
}

function setBtnLoading(loading) {
  if (loading) {
    btnStart.disabled = true;
    btnStart.classList.add("loading");
    if (btnIcon) { btnIcon.className = "spin"; btnIcon.innerHTML = icon("spinner"); }
    btnText.textContent = "Memproses...";
  } else {
    btnStart.disabled = false;
    btnStart.classList.remove("loading");
    if (btnIcon) { btnIcon.className = "btn-sparkle"; btnIcon.innerHTML = icon("sparkle"); }
    btnText.textContent = "Mulai Auto-Jawab";
  }
}

function showProgress(show) {
  progressWrap.classList.toggle("visible", show);
}

function resetState() {
  isRunning = false;
  setBtnLoading(false);
  showProgress(false);
}

function toggleLog() {
  logVisible = !logVisible;
  logSection.classList.toggle("visible", logVisible);
  logToggle.innerHTML = icon("list") + (logVisible ? " Sembunyikan Log" : " Tampilkan Log");
}

function log(type, text) {
  const line = document.createElement("div");
  line.className = "log-line " + type;
  const time = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  line.textContent = `${time}  ${text}`;
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}
