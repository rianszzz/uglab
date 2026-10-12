// background.js — UGLab Service Worker
//
// API Mode: any OpenAI-compatible endpoint (chat/completions) with the user's saved endpoint, key and model.
// Web Mode: relays the prompt to the Gemini / ChatGPT / Claude tab.

// ─── Config ───────────────────────────────────────────────────────────────────

let currentKeyIndex = 0;

async function getApiKeys() {
  const stored = await chrome.storage.local.get(["prelab_api_keys", "prelab_api_key"]);
  const raw = stored.prelab_api_keys || stored.prelab_api_key || "";
  if (Array.isArray(raw)) {
    return raw.map(k => (typeof k === "string" ? k.trim() : "")).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw.split(/[\n,]+/).map(k => k.trim()).filter(Boolean);
  }
  return [];
}

// ─── Service Worker Keep-Alive ────────────────────────────────────────────────
let _keepAliveTimer = null;
function startKeepAlive() {
  stopKeepAlive();
  _keepAliveTimer = setInterval(() => chrome.runtime.getPlatformInfo(() => { }), 20000);
}
function stopKeepAlive() {
  if (_keepAliveTimer) { clearInterval(_keepAliveTimer); _keepAliveTimer = null; }
}

// ─── Message Router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "PRELAB_START") {
    handleStart(msg, sendResponse);
    return true; // keep channel open
  }
  if (msg.type === "PRELAB_ACE") { // flush editor values into data-raw-code, or set one editor (code + container id)
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      args: [msg.id || null, msg.code ?? null],
      func: (id, code) => {
        const ed = el => (el.env && el.env.editor) || (window.ace && window.ace.edit(el));
        if (id && code !== null) {
          const el = document.getElementById(id)?.querySelector(".ace_editor");
          if (el) ed(el).setValue(code, 1);
          else document.getElementById(id)?.querySelector(".CodeMirror")?.CodeMirror?.setValue(code);
          return;
        }
        document.querySelectorAll(".ace_editor, .CodeMirror").forEach(el => {
          const val = el.CodeMirror ? el.CodeMirror.getValue() : ed(el).getValue();
          el.setAttribute("data-raw-code", val);
          if (!el.hasAttribute("data-prelab-original")) el.setAttribute("data-prelab-original", val);
        });
      },
    }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.type === "PRELAB_STATUS") {
    broadcastToLMS(msg.data);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "GEMINI_READY") {
    chrome.storage.local.get("prelab_pending_payload", (res) => {
      sendResponse({ payload: res.prelab_pending_payload || null });
    });
    return true;
  }

  if (msg.type === "GEMINI_DONE") {
    handleGeminiDone(msg.data);
    if (sender.tab && sender.tab.id) {
       // Beri jeda sedikit agar user sempat melihat indikator sukses di tab Gemini jika sedang melihatnya
       setTimeout(() => {
         chrome.tabs.remove(sender.tab.id).catch(() => { });
       }, 500);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "GEMINI_ERROR") {
    handleGeminiError(msg.error);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "PRELAB_START_AUTO") {
    // Jalankan scan otomatis lalu mulai flow
    const tabId = sender.tab.id;
    chrome.tabs.sendMessage(tabId, { type: "PRELAB_SCRAPE" }, (response) => {
      if (response && response.count > 0) {
        chrome.storage.local.get(["prelab_run_mode", "prelab_extra_prompt", "prelab_web_engine"]).then(stored => {
          handleStart({
            lmsTabId: tabId,
            mode: stored.prelab_run_mode || "api",
            webEngine: stored.prelab_web_engine || "gemini",
            extraPrompt: stored.prelab_extra_prompt || ""
          }, () => { });
        });
      }
    });
    return true;
  }
});

let _lastDoneId = null; // two injector copies in one tab both send GEMINI_DONE; handle one so the next batch (new tab) isn't chained twice
async function handleGeminiDone(data) {
  const { text, requestId } = data;
  if (requestId && requestId === _lastDoneId) return;
  _lastDoneId = requestId;
  const meta = await chrome.storage.local.get("prelab_pending_meta");
  let { lmsTabId, questionCount, rest, webEngine } = meta.prelab_pending_meta || {};
  const { prelab_pending_payload: pl } = await chrome.storage.local.get("prelab_pending_payload");

  if (!lmsTabId) return;

  try {
    const answers = (Array.isArray(data?.answers) && data.answers.length > 0) ? data.answers : parseAnswersFromText(text, questionCount);
    if (!answers) throw new Error("Gagal parse jawaban dari Web Engine.");
    // AI often echoes batch-local numbers ("Soal 1") instead of q.index: remap by position, then re-queue unanswered
    const ids = (pl?.questions || []).map(q => q.index);
    if (answers.length === ids.length && answers.some(a => !ids.includes(a.index))) answers.forEach((a, j) => { if (ids[j] !== undefined) a.index = ids[j]; });
    const miss = (pl?.questions || []).filter(q => !answers.some(a => a.index === q.index));
    if (miss.length < ids.length) rest = [...miss, ...(rest || [])]; // ponytail: retries only while a batch makes progress
    await deliverAnswersToLMS(lmsTabId, answers);
    broadcastToLMS({ status: "success", text: "✅ Web Engine Berhasil!" });
  } catch (err) {
    chrome.tabs.sendMessage(lmsTabId, { type: "PRELAB_ERROR", error: err.message }).catch(() => { });
  } finally {
    await chrome.storage.local.remove(["prelab_pending_payload", "prelab_pending_meta"]);
    // 600ms: GEMINI_DONE closes the engine tab at 500ms; chain after it so the next batch gets a fresh tab
    if (rest?.length) setTimeout(() => handleStart({ lmsTabId, mode: "web", webEngine, extraPrompt: pl?.extraPrompt, rest }, () => { }), 600);
  }
}

function handleGeminiError(error) {
  chrome.storage.local.get("prelab_pending_meta", (res) => {
    const lmsTabId = res.prelab_pending_meta?.lmsTabId;
    if (lmsTabId) {
      chrome.tabs.sendMessage(lmsTabId, { type: "PRELAB_ERROR", error: `Web Engine Error: ${error}` }).catch(() => { });
    }
    chrome.storage.local.remove(["prelab_pending_payload", "prelab_pending_meta"]);
  });
}

// ─── Start Flow ───────────────────────────────────────────────────────────────
async function handleStart(msg, sendResponse) {
  const { extraPrompt, lmsTabId } = msg;

  const stored = await chrome.storage.local.get("prelab_questions_cache");
  const questions = msg.rest || stored.prelab_questions_cache;
  if (!questions || questions.length === 0) {
    sendResponse({ ok: false, error: "Soal belum di-scan. Klik Scan Ulang Soal terlebih dahulu." });
    return;
  }

  sendResponse({ ok: true });
  const mode = msg.mode || "api";

  (async () => {
    try {
      startKeepAlive();
      const hasImages = questions.some(q => q.images && q.images.length > 0);

      const notify = (text, variant = "loading") => chrome.tabs.sendMessage(lmsTabId, {
        type: "PRELAB_STATUS_UPDATE",
        data: { status: variant, text: `⚡ ${text}` },
      }).catch(() => { });

      // --- WEB MODE FLOW (Forward to gemini.google.com or chatgpt.com) ---
      if (mode === "web") {
        const webEngine = msg.webEngine || "gemini";
        const isChatGPT = webEngine === "chatgpt";
        const isClaude = webEngine === "claude";
        const engineName = isChatGPT ? "ChatGPT Web" : isClaude ? "Claude Web" : "Gemini Web";
        const engineUrlMatch = isChatGPT ? "*://chatgpt.com/*" : isClaude ? "*://claude.ai/*" : "*://gemini.google.com/*";
        const engineUrlBase = isChatGPT ? "https://chatgpt.com/" : isClaude ? "https://claude.ai/new" : "https://gemini.google.com/app";

        notify(`Menyiapkan payload untuk ${engineName}...`, "loading");
        const BATCH = Infinity; // ponytail: one prompt = one tab = one injection; truncated tail is re-queued by handleGeminiDone, lower to batch only if parse fails
        const rest = questions.slice(BATCH);
        const batch = questions.slice(0, BATCH);
        const promptText = buildPrompt(batch, extraPrompt);
        const requestId = Date.now().toString();

        await chrome.storage.local.set({
          prelab_pending_payload: { 
            questions: batch, 
            extraPrompt, 
            images: batch.flatMap(q => q.images || []),
            requestId
          },
          prelab_pending_meta: { lmsTabId, requestId, questionCount: batch.length, rest, webEngine }
        });

        const sendWork = (tabId) => {
          chrome.tabs.sendMessage(tabId, { type: "PRELAB_DO_WORK", requestId }, (res) => {
            if (chrome.runtime.lastError || !res?.ok) {
              chrome.scripting.executeScript({
                target: { tabId },
                files: ["src/ai-injector.js"]
              }).then(() => {
                chrome.tabs.sendMessage(tabId, { type: "PRELAB_DO_WORK", requestId });
              }).catch(() => { });
            }
          });
        };

        // Cari apakah tab Engine sudah buka
        const tabs = await chrome.tabs.query({ url: engineUrlMatch });
        if (tabs.length > 0) {
          const targetTab = tabs[0];
          await chrome.tabs.update(targetTab.id, { active: true });
          if (targetTab.windowId) await chrome.windows.update(targetTab.windowId, { focused: true }).catch(() => { });
          sendWork(targetTab.id);
        } else {
          const newTab = await chrome.tabs.create({ url: engineUrlBase, active: true });
          if (newTab.windowId) await chrome.windows.update(newTab.windowId, { focused: true }).catch(() => { });
          const onUpdated = (tabId, info) => {
            if (tabId === newTab.id && info.status === "complete") {
              chrome.tabs.onUpdated.removeListener(onUpdated);
              sendWork(newTab.id);
            }
          };
          chrome.tabs.onUpdated.addListener(onUpdated);
        }
        return; // Flow web selesai di sini, ai-injector yang akan lapor balik
      }

      // --- API MODE FLOW ---
      const { prelab_api_model: model } = await chrome.storage.local.get("prelab_api_model");
      if (!model) throw new Error("Model belum diisi. Isi kolom Model lalu klik Simpan Credentials.");
      notify(`Mencoba ${model}...`);
      const res = await callChatAPI(questions, extraPrompt, model, hasImages);
      if (!res.ok) throw new Error(`API Error: ${res.error}`);
      const rawText = res.text;
      const usedEngine = res.model;

      console.log("[UGLab] === RAW AI RESPONSE ===\n", rawText);

      const answers = parseAnswersFromText(rawText, questions.length);
      if (!answers || answers.length === 0) {
        throw new Error(`Gagal parse jawaban dari ${usedEngine}.`);
      }

      console.log("[UGLab] === PARSED ANSWERS ===", JSON.stringify(answers, null, 2));
      await deliverAnswersToLMS(lmsTabId, answers);

    } catch (err) {
      chrome.tabs.sendMessage(lmsTabId, { type: "PRELAB_ERROR", error: err.message }).catch(() => { });
      chrome.runtime.sendMessage({ type: "PRELAB_POPUP_ERROR", error: err.message }).catch(() => { });
    } finally {
      stopKeepAlive();
    }
  })();
}

// ─── OpenAI-compatible API Call ───────────────────────────────────────────────
async function callChatAPI(questions, extraPrompt, model, isVision = false) {
  const SYSTEM = "Kamu adalah asisten akademik yang ahli. Jawab soal dengan akurasi 100%. Kembalikan HANYA JSON array di dalam tag ```json.";
  let promptText = buildPrompt(questions, extraPrompt);
  console.log("[UGLab] === PROMPT SENT TO AI ===\n", promptText.slice(0, 3000), "\n...(truncated)");

  // Optimasi: Potong prompt jika terlalu panjang (mencegah Context Overflow / Payload Too Large)
  const MAX_CHARS = isVision ? 120000 : 80000; // was 30000: a 15-question notebook silently lost its last questions
  if (promptText.length > MAX_CHARS) {
    promptText = promptText.slice(0, MAX_CHARS) + "\n\n...[SOAL TERPOTONG]...";
  }

  let messages = [{ role: "system", content: SYSTEM }];

  if (isVision) {
    const userContent = [{ type: "text", text: promptText }];
    questions.forEach(q => {
      (q.images || []).forEach(base64 => {
        userContent.push({
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${base64}` },
        });
      });
    });
    messages.push({ role: "user", content: userContent });
  } else {
    messages.push({ role: "user", content: promptText });
  }

  const apiKeys = await getApiKeys();
  const { prelab_api_endpoint: endpoint, prelab_creds_saved: saved } = await chrome.storage.local.get(["prelab_api_endpoint", "prelab_creds_saved"]);
  const u = endpoint && new URL(endpoint);
  if (saved && u && !await chrome.permissions.contains({ origins: [`${u.protocol}//${u.hostname}/*`] })) {
    return { ok: false, error: `Izin akses ke ${u.hostname} belum diberikan. Buka popup lalu klik Simpan Credentials dan pilih Allow.` };
  }
  if (!saved || !endpoint || apiKeys.length === 0) {
    return {
      ok: false,
      error: "API Mode belum aktif! Buka popup ekstensi, isi endpoint & API Key, lalu klik Simpan Credentials."
    };
  }

  // Attempt with retries and key rotation
  for (let attempt = 0; attempt < apiKeys.length; attempt++) {
    const key = apiKeys[(currentKeyIndex + attempt) % apiKeys.length];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    try {
      const resp = await fetch(`${endpoint.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.1,
          max_tokens: 8000,
          top_p: 1,
        }),
      });

      if (resp.status === 429) {
        console.warn(`[UGLab] Rate limit hit. Jeda 2 detik sebelum mencoba key berikutnya...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      if (!resp.ok) {
        const body = await resp.text();
        return { ok: false, error: `API ${resp.status} (${model}): ${body.slice(0, 100)}` };
      }

      const data = await resp.json();
      if (data.error) return { ok: false, error: data.error.message };
      return { ok: true, text: data.choices?.[0]?.message?.content ?? "", model };
    } catch (e) {
      if (attempt === apiKeys.length - 1) return { ok: false, error: e.message };
    }
  }
  return { ok: false, error: "Semua API key gagal (Rate Limit / Network / Invalid Key)." };
}

// ─── Build Prompt ─────────────────────────────────────────────────────────────
function buildPrompt(questions, extraPrompt) {
  const typeMap = {
    multichoice: "Pilihan Ganda (pilih 1)",
    truefalse: "Benar/Salah",
    multianswer: "Multi-Pilihan (bisa lebih dari 1)",
    shortanswer: "Isian Singkat",
    essay: "Essay",
    coding: "Coding/Pemrograman",
    multifill: "Isi Beberapa Kotak",
    match: "Menjodohkan / Pasangkan",
  };

  let prompt = `Kamu adalah asisten akademik ahli dengan kemampuan matematika, logika, dan pemrograman tingkat tinggi. Tugasmu adalah menjawab soal-soal berikut dengan keakuratan >99%.

${extraPrompt ? `Instruksi Tambahan dari Pengguna: ${extraPrompt}\n\n` : ""}

=== PROSES WAJIB (MANDATORY CHAIN OF THOUGHT) ===

1. KEL. SOAL: Identifikasi tipe soal, konteks (misal: Java, C++, Logika Dasar), dan apa yang dicari.
2. KERJA LANGKAH-DEMI-LANGKAH: Tulis seluruh proses penyelesaian secara teliti.
   - Untuk MATRIKS: Samakan elemen per-elemen, selesaikan sistem persamaan, substitusikan balik.
   - Untuk PEMROGRAMAN MULTIFILL: Lakukan ANALISIS MENDALAM untuk setiap [KOTAK KOSONG N]. Tuliskan letak kotak tersebut berada (di dalam parameter if, body if, argumen method, dll). Evaluasi secara eksplisit apakah kotak tersebut MEMBUTUHKAN PENUTUP SINTAKS (seperti titik-koma ';' atau kurung tutup) berdasarkan teks yang ada di luar boks.
   - Untuk LOGIKA/TRUE-FALSE: Cari celah/kontraeksempel dari kalimat.
3. KESIMPULAN FINAL: Nyatakan dengan jelas sebelum merender JSON akhir.

Tuliskan seluruh proses di dalam tag <KERJA>...</KERJA>.
SETELAH tag KERJA, output JSON final.

=== FORMAT OUTPUT ===

PENTING: Jawab HANYA dengan JSON array yang valid setelah tag KERJA. Tidak ada teks lain di luar tag KERJA dan JSON.

Format JSON:
[
  {
    "index": 0,
    "type": "multichoice",
    "jawaban": "teks jawaban yang dipilih",
    "index_pilihan": 0
  },
  ...
]

Field:
- "index": nomor urut soal (mulai dari 0)
- "type": tipe soal
- "jawaban": jawaban lengkap sebagai string
- "index_pilihan": untuk pilihan ganda = nomor urut opsi (0-based); untuk multi-select = array of nomor; untuk coding/essay/isian = null

=== SOAL-SOAL ===

`;

  if (questions.some(q => q.globalContext)) {
    const gCtx = questions.find(q => q.globalContext)?.globalContext || "";
    prompt += `=== PETUNJUK & INFORMASI MODUL NOTEBOOK ===\n${gCtx}\n\n`;
  }

  questions.forEach((q, i) => {
    const typeName = typeMap[q.type] || q.type;
    prompt += `--- Soal ${i + 1} (index: ${q.index}, tipe: ${typeName}) ---\n`;
    // the module instructions are already added once above; repeating them in every question blew the prompt past the size cap and cut off the last questions
    prompt += `${q.text.replace(/^\[Petunjuk & Modul\]:[\s\S]*?\n\n(?=\[Konteks Modul\])/, "")}\n`;

    if (q.options && q.options.length) {
      prompt += "Pilihan:\n";
      q.options.forEach((opt, j) => {
        prompt += `[Opsi ${j}]: ${opt.text}\n`;
      });
    }

    // Deteksi method-only (Java) dan Notebook (Colab/Jupyter)
    const isMethodOnly = /hanya\s*tulis\s*(definisi\s*)?method|only\s*write.*method|jangan\s*tulis\s*program\s*lengkap|method\s*only|tulis\s*definisi\s*method|jangan\s*ubah\s*kode|tuliskan\s*(sebuah\s*)?method/i.test(q.text);
    const isNotebook = /\[(Konteks Modul|Kode Soal)\]|<[.\s]*\.\.\.[.\s]*>|#\s*CODE\s*HERE|#\s*\.\.\./i.test(q.text) || Boolean(q.rawCode);

    if (q.type === "coding" || isMethodOnly || isNotebook) {
      if (isNotebook) {
        prompt += "(PENTING - NOTEBOOK: Tulis kode Python yang valid langsung di field \"jawaban\" dalam JSON, JANGAN gunakan \"TERPISAH\". Jika ada placeholder <...> di dalam ekspresi seperti data['<...>'].mean(), jawab HANYA nama kolom (contoh: 'strength') tanpa menduplikasi fungsi luarnya. Jika sel berisi blok kode, tulis seluruh blok kodenya secara bersih tanpa komentar placeholder.)\n";
      } else if (isMethodOnly) {
        prompt += "(PENTING: Tulis HANYA satu atau beberapa definisi method yang diminta. Template sudah disertakan — JANGAN tulis ulang class, import, atau method main(). Output hanya method signature + body saja, mulai dari access modifier. Gunakan indentasi 4 spasi standar Java di dalam method body. TIDAK ADA komentar atau penjelasan di dalam kode.)\n";
      } else {
        prompt += "(Berikan kode lengkap yang dapat dijalankan. TIDAK ADA penjelasan di dalam blok kode. JANGAN menyalin kode pengujian/contoh pemakaian dari soal; kembalikan HANYA template yang dilengkapi, pengujian ditambahkan otomatis oleh penilai.)\n";
      }
    }

    if (q.images && q.images.length > 0) {
      prompt += `[Soal ini memiliki ${q.images.length} gambar yang dilampirkan - analisis gambar dengan sangat cermat]\n`;
      prompt += "Petunjuk Penting: Jika ada potongan kode atau definisi class (superclass) di dalam gambar, gunakan informasi tersebut untuk membangun subclass. Periksa juga contoh output di bagian bawah soal atau gambar untuk memverifikasi rumus (misal: luas lingkaran, format angka, dsb).\n";
      if (q.text.includes("[GAMBAR")) {
        prompt += "Keterangan: Label [GAMBAR N] pada teks merujuk pada gambar ke-N yang dilampirkan (urut dari pertama).\n";
      }
    }

    if (q.dropdownOptions) {
      prompt += "\nPilihan untuk kotak kosong (WAJIB memilih dari list):\n";
      const uniqueOptions = [];
      q.dropdownOptions.forEach(box => {
        const optStr = box.options.join(", ");
        let found = uniqueOptions.find(u => u.optStr === optStr);
        if (!found) {
          found = { optStr, indexes: [] };
          uniqueOptions.push(found);
        }
        found.indexes.push(box.index);
      });
      uniqueOptions.forEach(u => {
        prompt += `- Kotak [${u.indexes.join(", ")}]: [${u.optStr}]\n`;
      });
    } else if (q.type === "match" && q.options) {
      prompt += "\nPilihan Jawaban (WAJIB memilih dari list ini secara literal):\n";
      const optList = q.options.map(o => o.text).join(", ");
      prompt += optList + "\n";

      if (optList.toLowerCase().includes("graph") || optList.toLowerCase().includes("graf")) {
        prompt += "\n[HINT ANALISIS GRAPH — BACA SETIAP GAMBAR SECARA CERMAT]:\n";
        prompt += "- Weighted Graph: Ada angka beban/bobot di setiap sisi antar node.\n";
        prompt += "- Directed Graph: Ada panah (arah) pada garisnya.\n";
        prompt += "- Undirected Graph: Garis lurus TANPA mata panah DAN TANPA angka bobot.\n";
        prompt += "- Acyclic Directed Graph (DAG): Directed graph yang tidak memiliki siklus.\n";
        prompt += "- Labelled Vertex: Node berlabel HURUF (A, B, C). Node berlabel ANGKA (1,2,3) BUKAN labelled vertex!\n";
      }
    }

    if (q.text.toLowerCase().includes("himpunan edge") || q.text.toLowerCase().includes("set of edges")) {
      prompt += "[HINT EDGE SET]:\n";
      prompt += "- Undirected: edge (1,2) sama dengan (2,1). Pilih representasi yang ada di opsi.\n";
      prompt += "- Directed: panah dari 1→2 hanya bisa ditulis (1,2), bukan (2,1).\n";
    }

    prompt += "\n";
  });

  prompt += `=== ATURAN AKURASI WAJIB ===

FORMAT JAWABAN KHUSUS:
1. PILIHAN GANDA: "jawaban" = teks opsi yang dipilih, "index_pilihan" = nomor urut opsi (0-based).
2. MULTI-PILIHAN (checkbox): "index_pilihan" = ARRAY nomor urut opsi yang benar (contoh: [0, 2]).
3. ISIAN BANYAK KOTAK (multifill): "jawaban" = ARRAY of string untuk setiap kotak secara berurutan. Contoh: ["2", "6.5", "3"]. 
   - PENTING: Panjang array WAJIB sama dengan jumlah [KOTAK KOSONG N] pada teks soal! Jangan melewatkan satupun kotak.
4. ESSAY: "jawaban" = "TERPISAH", lalu tulis jawaban di luar JSON dalam tag ===JAWABAN_N=== ... ===AKHIR_JAWABAN_N===.
5. CODING: Untuk notebook (Colab/Jupyter), tulis kode langsung di dalam properti "jawaban" di JSON. Untuk soal coding panjang di iLab LMS, baru gunakan "jawaban" = "TERPISAH".
6. DROPDOWN/MATCHING: "jawaban" = ARRAY of string teks pilihan secara LITERAL sesuai opsi.

PRESISI WAJIB:
- DESIMAL: Jangan bulatkan kecuali diperintahkan. Jika hasilnya 6.5, tulis "6.5" bukan "6,5" atau "7".
- FORMAT INDONESIA: Titik (.) sebagai pemisah ribuan, koma (,) sebagai pemisah desimal. Contoh: "Rp 717.500.000", tidak "Rp 717500000".
- KODING OUTPUT: Jika contoh soal menampilkan "Enter a number: 10", kode HARUS mencetak "Enter a number: " persis (termasuk spasi).
- CASING KETAT: "Hello World" ≠ "hello world" ≠ "Hello world!". Perhatikan huruf besar/kecil dan tanda baca.

KHUSUS ISIAN KODE MULTIFILL (PEMROGRAMAN):
- Jika kotak kosong bertujuan untuk mengisi suatu statement/baris kode utuh (seperti deklarasi, perulangan, atau assignment variabel), WAJIB gunakan sintaks sempurna.
- JANGAN LUPA tambahkan titik-koma (;) di akhir pernyataan jika itu adalah bahasa seperti C, C++, atau Java, KECUALI titik-koma tersebut sudah tercetak secara eksplisit di luar boks.
- Perhatikan karakter yang mencetak di luar boks (misal jika ')' sudah ada di luar boks, jangan ditulis ulang di dalam boks). Sintaks harus menyatu utuh dengan lingkungan sekitarnya.
- PERHATIAN: Periksa indeks [KOTAK KOSONG N] dengan hati-hati. Kotak pertama biasanya adalah KONDISI (misal 'y == 10'), lalu kotak berikutnya adalah ISI STATEMENT. Jangan sampai isi statement tertukar ke kotak kondisi! Penuhi seluruh array dari indeks 0 hingga habis.

KHUSUS PYTHON / GOOGLE COLAB / JUPYTER NOTEBOOK:
- BACA CERMAT PETUNJUK & MODUL: Jika modul menyediakan URL dataset (misal raw.githubusercontent.com/.../concrete.csv), WAJIB gunakan URL tersebut pada pd.read_csv(url), jangan mengarang nama file lokal.
- Selesaikan seluruh placeholder ('<...>', "<...>", <...>, '# ...') menjadi kode Python yang valid. Jangan tinggalkan karakter '<...>' sama sekali.
- Jika placeholder ada di dalam indexing kolom data['<...>'].mean(), jawab HANYA nama kolom yang benar (contoh: 'strength' atau strength), jangan membungkusnya ulang dengan print(...) atau data[...].
- Untuk sel penjelasan boxplot/visualisasi (tanda '# ...'), berikan penjelasan yang ringkas dan relevan.
- KHUSUS NOTEBOOK: Tulis kode Python yang valid LANGSUNG di dalam properti "jawaban" pada JSON array (contoh: "jawaban": "data.head()", "jawaban": "'strength'"). JANGAN menulis "TERPISAH"!

KHUSUS PEMROGRAMAN BERBASIS OBJEK (JAVA/OOP):
- Perhatikan relasi antar class (Inheritance). Jika diminta membuat subclass (misal: class Lingkaran extends Bangun), pastikan penamaan class dan keyword 'extends' tertulis dengan benar.
- Pastikan semua field (atribut) dideklarasikan dengan access modifier yang diminta (biasanya private).
- Jika method subclass diminta mengupdate nilai di superclass (misal: update field 'luas' di class Bangun), gunakan method setter yang tersedia di superclass (misal: setLuas(n)) atau penuhi logika yang diminta soal.
- Gunakan Math.PI untuk nilai PI yang presisi jika berhubungan dengan lingkaran/bola.
- Pastikan semua method (getter/setter) mengembalikan tipe data yang sesuai (double/int/String).

KHUSUS MATEMATIKA & MATRIKS:
- TRANSPOSE (A^T): elemen posisi (i,j) di A menjadi posisi (j,i) di A^T. Baris jadi kolom, kolom jadi baris.
  Contoh: A=[[1,2],[3,4]] → A^T=[[1,3],[2,4]]. BUKAN [[4,3],[2,1]] dan BUKAN [[1,2],[3,4]].
- INVERS 2×2: [[a,b],[c,d]]^-1 = 1/(ad-bc) × [[d,-b],[-c,a]]. Hitung determinan dulu, lalu tukar diagonal & negasikan off-diagonal.
- KOFAKTOR C_ij = (-1)^(i+j) × M_ij, di mana M_ij adalah determinan minor (hapus baris-i dan kolom-j).
- DETERMINAN 3×3: Ekspansi kofaktor baris pertama. Hati-hati tanda (+/-) pola checkerboard.
- UNTUK A=B: samakan SETIAP elemen posisi (baris, kolom) satu per satu untuk mendapat sistem persamaan.
- Selesaikan sistem persamaan secara urut. Substitusikan nilai yang sudah ditemukan.
- WAJIB VERIFIKASI: Substitusikan semua nilai kembali ke persamaan ASAL dan pastikan semua benar.
- Hitung ULANG jika hasil tidak cocok dengan salah satu opsi yang tersedia.

KHUSUS SOAL MULTI-PILIHAN (CHECKBOX / MULTIANSWER):
- Evaluasi setiap opsi secara TERPISAH dan INDEPENDEN.
- Dalam materi teori (ciri-ciri, sifat, definisi dasar), jangan terlalu kaku! Jika persyaratannya secara umum benar sesuai modul kuliah, MAKA PILIH.
- Seringkali terdapat 2, 3, atau lebih opsi yang benar sekaligus. Jangan ragu memborong opsi jika faktanya memang benar.

DETEKSI JEBAKAN:
- True/False: Kata "selalu", "semua", "tidak pernah", "pasti" hampir selalu SALAH (terlalu absolut). Cari kontraeksempel.
- Pilihan Ganda: Eliminasi yang jelas salah dulu. Jika ragu, hitung ulang dari awal.
- Perbandingan angka: Hitung digit ribuan dan desimal dengan SANGAT teliti.

Contoh format output yang benar:
<KERJA>
[Tulis seluruh proses perhitungan di sini]
</KERJA>
\`\`\`json
[
  { "index": 0, "type": "multichoice", "jawaban": "6,5", "index_pilihan": 3 },
  { "index": 1, "type": "coding", "jawaban": "TERPISAH", "index_pilihan": null }
]
\`\`\`
===JAWABAN_1===
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
===AKHIR_JAWABAN_1===
`;

  return prompt;
}


// ─── Parse Answers from AI Response ──────────────────────────────────────────
function parseAnswersFromText(text, questionCount) {
  const fixInvalidJson = (str) => {
    let fixed = str
      .replace(/""([^"]*)""/g, '"\\"$1\\""')
      .replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, "\\\\");

    fixed = fixed.replace(
      /("jawaban"\s*:\s*")([\s\S]*?)("\s*,\s*"index_pilihan"\s*:|"\s*})/g,
      (match, start, content, end) => start + content.replace(/(?<!\\)"/g, '\\"') + end
    );
    fixed = fixed.replace(
      /("jawaban"\s*:\s*")([\s\S]*?)("\s*,\s*"index_pilihan"\s*:|"\s*})/g,
      (match, start, content, end) =>
        start + content.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + end
    );
    return fixed;
  };

  const attemptParse = (str) => {
    try { return JSON.parse(str); } catch { return null; }
  };

  let searchArea = text;
  // Strip reasoning tags — JSON appears AFTER the closing tag
  if (text.includes("</KERJA>")) {
    searchArea = text.split("</KERJA>").pop();
  } else if (text.includes("</ANALISIS>")) {
    searchArea = text.split("</ANALISIS>").pop();
  }

  const patterns = [
    /```json\s*(\[[\s\S]*?\])\s*```/,
    /```\s*(\[[\s\S]*?\])\s*```/,
    /(\[\s*\{\s*"index"[\s\S]*\}\s*\])/,
    /(\[[\s\S]*"jawaban"[\s\S]*\])/,
  ];

  let parsedArray = null;
  const jsonStart = searchArea.search(/\[\s*\{[\s\S]*?"index"\s*:/);
  if (jsonStart !== -1) {
    const jsonEnd = searchArea.lastIndexOf("]");
    if (jsonEnd > jsonStart) {
      const slice = searchArea.slice(jsonStart, jsonEnd + 1);
      let parsed = attemptParse(slice) ?? attemptParse(fixInvalidJson(slice));
      if (Array.isArray(parsed) && parsed.length > 0) parsedArray = parsed;
    }
  }

  if (!parsedArray) {
    for (const pattern of patterns) {
      const match = searchArea.match(pattern) || text.match(pattern);
      if (match) {
        let parsed = attemptParse(match[1]) ?? attemptParse(fixInvalidJson(match[1]));
        if (Array.isArray(parsed) && parsed.length > 0) { parsedArray = parsed; break; }
      }
    }
  }

  if (!parsedArray) {
    const trimmed = text.trim();
    if (trimmed.startsWith("[")) {
      const parsed = attemptParse(trimmed) ?? attemptParse(fixInvalidJson(trimmed));
      if (Array.isArray(parsed) && parsed.length > 0) parsedArray = parsed;
    }
  }

  if (parsedArray) {
    const hasZero = /(?:={2,3}|#{1,3}|\*\*|\b)\s*JAWABAN[\s_-]*0\b/i.test(text);
    parsedArray.forEach(ans => {
      if (ans.type === "coding" || ans.type === "essay" || ans.jawaban === "TERPISAH") {
        const targetNum = hasZero ? ans.index : ans.index + 1;
        const re = new RegExp(
          `(?:={2,3}|#{1,3}|\\*\\*)?\\s*JAWABAN[\\s_-]*${targetNum}\\s*(?:={2,3}|\\*\\*|:)?\\s*\\n?([\\s\\S]*?)(?=(?:={2,3}|#{1,3}|\\*\\*)?\\s*(?:AKHIR_JAWABAN|JAWABAN)[\\s_-]*\\d*|$)`,
          "i"
        );
        const externalMatch = text.match(re);
        if (externalMatch && externalMatch[1]?.trim()) {
          let raw = externalMatch[1].trim().replace(/^={2,3}\s*AKHIR_JAWABAN[\s_-]*\d*\s*={2,3}/i, "").trim();
          raw = raw.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
          if (raw && raw !== "TERPISAH") {
            ans.jawaban = raw;
          }
        }
      }
    });
    return parsedArray;
  }

  return null;
}

// ─── Deliver Answers to LMS Tab ───────────────────────────────────────────────
async function deliverAnswersToLMS(lmsTabId, answers) {
  let delivered = false;

  // Enrich answers with cellId from questions cache to prevent off-by-one shifts
  const cache = await chrome.storage.local.get("prelab_questions_cache");
  const questions = cache.prelab_questions_cache || [];
  const mappedAnswers = answers.map((ans, idx) => {
    const q = questions.find(item => item.index === ans.index) || questions[idx];
    return { ...ans, cellId: ans.cellId || q?.cellId };
  });

  // Channel 1: Direct message
  try {
    await chrome.tabs.sendMessage(lmsTabId, { type: "PRELAB_ANSWERS", answers: mappedAnswers });
    delivered = true;
  } catch { }

  // Channel 2: scripting.executeScript (Direct Colab/Jupyter MAIN world model sync & runAll)
  try {
    await chrome.scripting.executeScript({
      target: { tabId: lmsTabId },
      world: "MAIN",
      args: [mappedAnswers],
      func: (answersJson) => {
        const replaceCode = (text, ans) => {
          const cleanAns = ans.trim();
          if (!cleanAns || cleanAns === "TERPISAH") return text;
          const trimmedText = text.trim();
          if (!trimmedText || trimmedText === "# CODE HERE") return cleanAns;

          const lines = text.split("\n");
          const pIdx = lines.findIndex(l => l.includes("<...>") || l.includes("# ...") || l.trim() === "TERPISAH");
          if (pIdx !== -1) {
            const line = lines[pIdx].trim();
            const isFull = cleanAns.includes("print(") || cleanAns.includes("=") || cleanAns.includes("\n") ||
              /\.\w+\(/.test(cleanAns) || /^['"]?<...>['"]?;?$/.test(line) || line === "# ..." || line === "TERPISAH";
            if (isFull) {
              lines[pIdx] = line === "# ..." ? cleanAns.split("\n").map(l => l.startsWith("#") ? l : "# " + l).join("\n") : cleanAns; // explanation cells must stay comments
              return lines.join("\n");
            }
          }

          if (text.includes("'<...>'") || text.includes("'TERPISAH'")) {
            const p = text.includes("'<...>'") ? "'<...>'" : "'TERPISAH'";
            return text.replace(p, /^['"].*['"]$/.test(cleanAns) ? cleanAns : `'${cleanAns}'`);
          }
          if (text.includes('"<...>"') || text.includes('"TERPISAH"')) {
            const p = text.includes('"<...>"') ? '"<...>"' : '"TERPISAH"';
            return text.replace(p, /^['"].*['"]$/.test(cleanAns) ? cleanAns : `"${cleanAns}"`);
          }
          if (text.includes("<...>")) {
            return text.replace(/<[.\s]*\.\.\.[.\s]*>/g, () => cleanAns);
          }
          if (text.includes("# ...")) {
            return text.replace(/^([ \t]*)#\s*\.\.\.\s*$/m, (m, indent) => {
              return cleanAns.split("\n").map((l, i) => i === 0 ? indent + l : indent + l).join("\n");
            });
          }
          return text;
        };

        const cleanAns = (ans) => {
          let code = (typeof ans?.jawaban === "string" ? ans.jawaban : "").trim();
          if (code === "TERPISAH") return "";
          return code.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
        };

        // 1. Google Colab
        const nb = window.colab?.global?.notebook;
        if (nb && Array.isArray(nb.cells)) {
          const exerciseCells = nb.cells.filter(c => {
            if (!c.model || c.model.type !== "code") return false;
            const t = c.model.getText() || "";
            return t.includes("# CODE HERE") || t.includes("<...>") || t.includes("# ...");
          });

          for (let i = 0; i < answersJson.length; i++) {
            const ansObj = answersJson[i];
            const code = cleanAns(ansObj);
            const cell = (ansObj?.cellId && nb.cells.find(c => c.cellId === ansObj.cellId || c.id === ansObj.cellId)) || exerciseCells[i];
            if (code && cell) {
              const cur = (typeof cell.getText === "function" ? cell.getText() : cell.model?.getText()) || "";
              const updated = replaceCode(cur, code);
              if (typeof cell.setText === "function") cell.setText(updated);
              else if (typeof cell.model?.setText === "function") cell.model.setText(updated);
              if (cell.model?.textModel) cell.model.textModel.setValue(updated);
            }
          }

          setTimeout(() => {
            if (typeof nb.runAll === "function") nb.runAll();
            else document.querySelector('[command="runall"]')?.click();
          }, 500);
          return;
        }

        // 2. Jupyter Classic (window.Jupyter)
        if (typeof window.Jupyter !== "undefined" && window.Jupyter.notebook?.get_cells) {
          const jCells = window.Jupyter.notebook.get_cells().filter(c => {
            if (c.cell_type !== "code") return false;
            const t = c.get_text() || "";
            return t.includes("# CODE HERE") || t.includes("<...>") || t.includes("# ...");
          });

          for (let i = 0; i < answersJson.length; i++) {
            const code = cleanAns(answersJson[i]);
            const c = jCells[i];
            if (code && c) {
              const cur = c.get_text() || "";
              c.set_text(replaceCode(cur, code));
            }
          }

          setTimeout(() => {
            if (typeof window.Jupyter.notebook.execute_all_cells === "function") {
              window.Jupyter.notebook.execute_all_cells();
            }
          }, 500);
          return;
        }

        // 2b. JupyterLab / Notebook 7 with the app exposed: write through the notebook model so cells outside the viewport
        //     (no editor in the DOM) are filled too.
        const jw = window.jupyterapp?.shell?.currentWidget?.content?.widgets;
        const mTargets = (jw || []).filter(w => w.model.type === "code" && /# CODE HERE|<\.\.\.>|# \.\.\./.test(w.model.sharedModel.getSource()));
        if (mTargets.length > 0) {
          for (let i = 0; i < answersJson.length; i++) {
            const code = cleanAns(answersJson[i]);
            const target = mTargets[i];
            if (code && target) target.model.sharedModel.setSource(replaceCode(target.model.sharedModel.getSource(), code));
          }
          setTimeout(async () => {
            await window.__uglabPreflight?.().catch(() => { });
            await window.jupyterapp.commands.execute("notebook:run-all-cells").catch(() => { });
          }, 500);
          return;
        }

        // 3. JupyterLab / Modern Jupyter / try-jupyter (CodeMirror 6 / DOM)
        const jpCodeCells = Array.from(document.querySelectorAll('.jp-CodeCell, .jp-Cell'));
        const jpTargets = [];
        jpCodeCells.forEach(cell => {
          const cm = cell.querySelector('.cm-content');
          const view = cm?.cmView?.view;
          const doc = view ? view.state.doc.toString() : (cm?.innerText || "");
          if (doc.includes("# CODE HERE") || doc.includes("<...>") || doc.includes("# ...")) {
            jpTargets.push({ cell, cm, view, doc });
          }
        });

        if (jpTargets.length > 0) {
          for (let i = 0; i < answersJson.length; i++) {
            const code = cleanAns(answersJson[i]);
            const target = jpTargets[i];
            if (code && target) {
              const cur = target.view ? target.view.state.doc.toString() : target.doc;
              const updated = replaceCode(cur, code);
              if (target.view) {
                target.view.dispatch({
                  changes: { from: 0, to: target.view.state.doc.length, insert: updated }
                });
              } else if (target.cm) {
                target.cm.innerText = updated;
              }
            }
          }

          setTimeout(async () => {
            await window.__uglabPreflight?.().catch(() => { }); // Pyodide: install missing libs silently before running
            const runBtn = document.querySelector('[data-command="notebook:restart-run-all"]') ||
                           document.querySelector('[data-command="notebook:run-all-cells"]') ||
                           document.querySelector('[data-command="runmenu:run-all"]');
            if (runBtn) runBtn.click();
          }, 500);
          return;
        }
      },
      args: [mappedAnswers],
    });
    delivered = true;
  } catch { }

  // Channel 3: Storage fallback (content script listening via storage.onChanged)
  if (!delivered) {
    await chrome.storage.local.set({
      prelab_answers_pending: { answers, lmsTabId, timestamp: Date.now() },
    });
  }

  // Fokuskan kembali ke tab LMS
  try {
    await chrome.tabs.update(lmsTabId, { active: true });
    const tab = await chrome.tabs.get(lmsTabId);
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  } catch { }

  // Beritahu popup bahwa proses selesai
  chrome.runtime.sendMessage({ type: "PRELAB_POPUP_DONE", count: answers.length }).catch(() => { });
}

// ─── Broadcast Status to LMS Tabs ─────────────────────────────────────────────
function broadcastToLMS(data) {
  chrome.tabs.query({
    url: [
      "https://ujian.gunadarma.ac.id/*",
      "https://praktikum.gunadarma.ac.id/*",
      "https://v-class.gunadarma.ac.id/*",
      "https://elearning.gunadarma.ac.id/*",
      "https://colab.research.google.com/*",
      "https://colab.google/*",
      "https://jupyter.org/*",
      "*://localhost/*",
    ],
  }).then(tabs => {
    tabs.forEach(tab =>
      chrome.tabs.sendMessage(tab.id, { type: "PRELAB_STATUS_UPDATE", data }).catch(() => { })
    );
  });
}
