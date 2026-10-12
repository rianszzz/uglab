// popup.js — UGLab Popup Controller

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
  setupListeners();
  await detectCurrentTab();
});

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

  // Load API Key
  chrome.storage.local.get("prelab_api_keys", (res) => {
    if (res.prelab_api_keys) {
      if (inputApiKey) inputApiKey.value = res.prelab_api_keys;
      if (apiKeyStatus) {
        apiKeyStatus.textContent = "✓ Tersimpan";
        apiKeyStatus.classList.add("saved");
      }
    } else {
      if (apiKeyStatus) {
        apiKeyStatus.textContent = "Belum diisi";
        apiKeyStatus.classList.remove("saved");
      }
    }
  });

  // Save API Key on input
  inputApiKey?.addEventListener("input", () => {
    const val = inputApiKey.value.trim();
    chrome.storage.local.set({ prelab_api_keys: val });
    if (val) {
      apiKeyStatus.textContent = "✓ Tersimpan";
      apiKeyStatus.classList.add("saved");
    } else {
      apiKeyStatus.textContent = "Belum diisi";
      apiKeyStatus.classList.remove("saved");
    }
  });

  // Toggle API Key visibility
  btnToggleKeyVisibility?.addEventListener("click", () => {
    if (inputApiKey.type === "password") {
      inputApiKey.type = "text";
      btnToggleKeyVisibility.textContent = "🔒";
    } else {
      inputApiKey.type = "password";
      btnToggleKeyVisibility.textContent = "👁️";
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

  const modeRes = await chrome.storage.local.get(["prelab_run_mode", "prelab_web_engine", "prelab_api_keys"]);
  const mode = $("mode-web")?.classList.contains("active") ? "web" : (modeRes.prelab_run_mode || "api");
  const webEngine = $("web-chatgpt")?.classList.contains("active") ? "chatgpt" : ($("web-claude")?.classList.contains("active") ? "claude" : (modeRes.prelab_web_engine || "gemini"));
  const isWeb = mode === "web";
  const webEngineName = webEngine === "chatgpt" ? "ChatGPT Web" : webEngine === "claude" ? "Claude Web" : "Gemini Web";

  const hasImages = detectedQuestions.some(q => q.hasImages);
  const engineLabelEl = document.getElementById("engineLabel");
  const engineModelEl = document.getElementById("engineModel");
  const engineName = isWeb ? webEngineName : (hasImages ? "SambaNova Vision" : "SambaNova Text");

  if (engineLabelEl) engineLabelEl.textContent = engineName;
  if (engineModelEl) engineModelEl.textContent = isWeb ? (webEngine === "chatgpt" ? "GPT-4o" : "Gemini 2.5") : (hasImages ? "Meta-Llama-3.3-70B (Teks Saja)" : "Meta-Llama-3.3-70B");

  setStatus("active", `Mengirim ke ${engineName}...`);
  showProgress(true);
  log("info", "Memulai proses auto-jawab...");
  log("info", `Routing: ${detectedQuestions.length} soal → ${engineName}${hasImages && !isWeb ? " (PERINGATAN: SambaNova tidak baca gambar!)" : ""}`);

  try {
    const apiKeys = (modeRes.prelab_api_keys || "").trim();

    if (mode === "api" && !apiKeys) {
      setStatus("error", "API Key belum diisi! Masukkan key di atas.");
      log("err", "API Key SambaNova/Groq belum diatur. Silakan masukkan API Key Anda.");
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
    if (polls > 60) { // 60s timeout (OpenRouter cloud API)
      clearInterval(poll);
      setStatus("error", "Timeout: Ollama tidak merespon");
      log("err", "Timeout 120 detik. Pastikan Ollama berjalan: ollama serve");
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
  setStatus("success", `✓ Selesai! ${count || "Semua"} soal terjawab`);
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
    if (btnIcon) { btnIcon.className = "spin"; btnIcon.textContent = "⟳"; }
    btnText.textContent = "Memproses...";
  } else {
    btnStart.disabled = false;
    btnStart.classList.remove("loading");
    if (btnIcon) { btnIcon.className = "btn-sparkle"; btnIcon.textContent = "✦"; }
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
  logToggle.textContent = logVisible ? "📋 Sembunyikan Log" : "📋 Tampilkan Log";
}

function log(type, text) {
  const line = document.createElement("div");
  line.className = "log-line " + type;
  const time = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const prefix = type === "ok" ? "✓" : type === "err" ? "✗" : "›";
  line.textContent = `${time} ${prefix} ${text}`;
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}
