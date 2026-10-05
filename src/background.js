// background.js — UGLab Service Worker (v7 — Multi-Model Chain Fallback)
//
// Routing strategy:
//   Soal TEKS     → TEXT_MODEL_CHAIN [7 model Groq, sequential 429 fallback]
//                 → Emergency: Gemini 2.0 Flash
//   Soal GAMBAR   → VISION_MODEL_CHAIN [4 model Groq, sequential 429 fallback]
//                 → Emergency: Gemini 2.0 Flash Vision

// ─── Config ───────────────────────────────────────────────────────────────────
// SambaNova Configuration
const GROQ_URL = "https://api.sambanova.ai/v1/chat/completions";

const TEXT_MODEL_CHAIN = [
  "Meta-Llama-3.3-70B-Instruct", // SambaNova Text
  "DeepSeek-V3.2"
];

// SambaNova doesn't support Vision anymore. We fallback to Text model and STRIP images.
const VISION_MODEL_CHAIN = [
  "Meta-Llama-3.3-70B-Instruct"
];

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

async function handleGeminiDone(data) {
  const { text, requestId } = data;
  const meta = await chrome.storage.local.get("prelab_pending_meta");
  const { lmsTabId, questionCount } = meta.prelab_pending_meta || {};

  if (!lmsTabId) return;

  try {
    const answers = parseAnswersFromText(text, questionCount);
    if (!answers) throw new Error("Gagal parse jawaban dari Web Engine.");
    await deliverAnswersToLMS(lmsTabId, answers);
    broadcastToLMS({ status: "success", text: "✅ Web Engine Berhasil!" });
  } catch (err) {
    chrome.tabs.sendMessage(lmsTabId, { type: "PRELAB_ERROR", error: err.message }).catch(() => { });
  } finally {
    await chrome.storage.local.remove(["prelab_pending_payload", "prelab_pending_meta"]);
  }
}

function handleGeminiError(error) {
  chrome.storage.local.get("prelab_pending_meta", (res) => {
    const lmsTabId = res.prelab_pending_meta?.lmsTabId;
    if (lmsTabId) {
      chrome.tabs.sendMessage(lmsTabId, { type: "PRELAB_ERROR", error: `Web Engine Error: ${error}` }).catch(() => { });
    }
  });
}

// ─── Start Flow ───────────────────────────────────────────────────────────────
async function handleStart(msg, sendResponse) {
  const { extraPrompt, lmsTabId } = msg;

  const stored = await chrome.storage.local.get("prelab_questions_cache");
  const questions = stored.prelab_questions_cache;
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
        const engineUrlBase = isChatGPT ? "https://chatgpt.com/" : isClaude ? "https://claude.ai/new" : "https://gemini.google.com/";

        notify(`Menyiapkan payload untuk ${engineName}...`, "loading");
        const promptText = buildPrompt(questions, extraPrompt);
        const requestId = Date.now().toString();

        await chrome.storage.local.set({
          prelab_pending_payload: { 
            questions, 
            extraPrompt, 
            images: questions.flatMap(q => q.images || []),
            requestId
          },
          prelab_pending_meta: { lmsTabId, requestId, questionCount: questions.length }
        });

        // Cari apakah tab Engine sudah buka
        const tabs = await chrome.tabs.query({ url: engineUrlMatch });
        if (tabs.length > 0) {
          await chrome.tabs.update(tabs[0].id, { active: true });
          // Kirim perintah langsung ke content script di tab tersebut
          chrome.tabs.sendMessage(tabs[0].id, { type: "PRELAB_DO_WORK", requestId }).catch(() => { });
        } else {
          await chrome.tabs.create({ url: engineUrlBase });
        }
        return; // Flow web selesai di sini, ai-injector yang akan lapor balik
      }

      // --- API MODE FLOW ---
      let rawText = null;
      let usedEngine = "";

      if (!hasImages) {
        // --- TEXT FLOW: Sequential model chain ---
        const modelChain = TEXT_MODEL_CHAIN;
        let res = { ok: false, error: "Belum dicoba" };
        for (let i = 0; i < modelChain.length; i++) {
          notify(`[${i + 1}/${modelChain.length}] Mencoba ${modelChain[i]}...`);
          res = await callGroqAPI(questions, extraPrompt, modelChain[i]);
          if (res.ok) break;
          console.warn(`[UGLab] Model ${modelChain[i]} gagal: ${res.error}`);
        }

        if (!res.ok) {
          console.warn("[UGLab] Semua model gagal. Mengembalikan error API.");
          throw new Error(`SambaNova API Error: ${res.error}`);
        } else {
          rawText = res.text;
          usedEngine = `SambaNova ${res.model}`;
        }
      } else {
        // --- VISION FLOW: Sequential vision model chain ---
        const visionChain = VISION_MODEL_CHAIN;
        let res = { ok: false, error: "Belum dicoba" };
        for (let i = 0; i < visionChain.length; i++) {
          notify(`[${i + 1}/${visionChain.length}] Vision (Teks-Only): ${visionChain[i]}...`);
          res = await callGroqAPI(questions, extraPrompt, visionChain[i], true);
          if (res.ok) break;
          console.warn(`[UGLab] Model ${visionChain[i]} gagal: ${res.error}`);
        }

        if (!res.ok) {
          console.warn("[UGLab] Semua model gagal. Mengembalikan error API.");
          throw new Error(`SambaNova API Error: ${res.error}`);
        } else {
          rawText = res.text;
          usedEngine = `SambaNova (Vision Stripped) ${res.model}`;
        }
      }


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

// ─── Unified Groq API Call ────────────────────────────────────────────────────
async function callGroqAPI(questions, extraPrompt, model, isVision = false) {
  const SYSTEM = "Kamu adalah asisten akademik yang ahli. Jawab soal dengan akurasi 100%. Kembalikan HANYA JSON array di dalam tag ```json.";
  let promptText = buildPrompt(questions, extraPrompt);
  console.log("[UGLab] === PROMPT SENT TO AI ===\n", promptText.slice(0, 3000), "\n...(truncated)");

  // Optimasi: Potong prompt jika terlalu panjang (mencegah Context Overflow / Payload Too Large)
  const MAX_CHARS = isVision ? 60000 : 30000;
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
  if (!apiKeys || apiKeys.length === 0) {
    return {
      ok: false,
      error: "API Key belum diatur! Buka popup ekstensi dan masukkan API Key SambaNova/Groq Anda."
    };
  }

  // Attempt with retries and key rotation
  for (let attempt = 0; attempt < apiKeys.length; attempt++) {
    const key = apiKeys[(currentKeyIndex + attempt) % apiKeys.length];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    try {
      const resp = await fetch(GROQ_URL, {
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
        return { ok: false, error: `SambaNova ${resp.status} (${model}): ${body.slice(0, 100)}` };
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

  questions.forEach((q, i) => {
    const typeName = typeMap[q.type] || q.type;
    prompt += `--- Soal ${i + 1} (index: ${q.index}, tipe: ${typeName}) ---\n`;
    prompt += `${q.text}\n`;

    if (q.options && q.options.length) {
      prompt += "Pilihan:\n";
      q.options.forEach((opt, j) => {
        prompt += `[Opsi ${j}]: ${opt.text}\n`;
      });
    }

    // Deteksi method-only: berlaku untuk type "coding" MAUPUN stale cache (shortanswer, dll)
    const isMethodOnly = /hanya\s*tulis\s*(definisi\s*)?method|only\s*write.*method|jangan\s*tulis\s*program\s*lengkap|method\s*only|tulis\s*definisi\s*method|jangan\s*ubah\s*kode|tuliskan\s*(sebuah\s*)?method/i.test(q.text);
    if (q.type === "coding" || isMethodOnly) {
      if (isMethodOnly) {
        prompt += "(PENTING: Tulis HANYA satu atau beberapa definisi method yang diminta. Template sudah disertakan — JANGAN tulis ulang class, import, atau method main(). Output hanya method signature + body saja, mulai dari access modifier. Gunakan indentasi 4 spasi standar Java di dalam method body. TIDAK ADA komentar atau penjelasan di dalam kode.)\n";
      } else {
        prompt += "(Berikan kode lengkap yang dapat dijalankan. TIDAK ADA penjelasan di dalam blok kode.)\n";
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
5. CODING: "jawaban" = "TERPISAH", lalu tulis KODE MURNI (tanpa penjelasan, tanpa markdown) di ===JAWABAN_N=== ... ===AKHIR_JAWABAN_N===.
6. DROPDOWN/MATCHING: "jawaban" = ARRAY of string teks pilihan secara LITERAL sesuai opsi.

PRESISI WAJIB:
- DESIMAL: Jangan bulatkan kecuali diperintahkan. Jika hasilnya 6.5, tulis "6.5" bukan "6,5" atau "7".
- FORMAT INDONESIA: Titik (.) sebagai pemisah ribuan, koma (,) sebagai pemisah desimal. Contoh: "Rp 717.500.000", tidak "Rp 717500000".
- KODING OUTPUT: Jika contoh soal menampilkan "Enter a number: 10", kode HARUS mencetak "Enter a number: " persis (termasuk spasi).
- CASING KETAT: "Hello World" ≠ "hello world" ≠ "Hello world!". Perhatikan huruf besar/kecil dan tanda baca.

KHUSUS ISIAN KODE MULTIFILL (PEMROGRAMAN):
- Jika kotak kosong bertujuan untuk mengisi suatu statement/baris kode utuh (seperti deklarasi, perulangan, atau assignment variabel), WAJIB gunakan sintaks sempurna.
- JANGAN LUPA tambahkan titik-koma (;) di akhir pernyataan jika itu adalah bahasa seperti C, C++, atau Java, KECUALI titik-koma tersebut sudah tercetak secara eksplisit di luar boks.
- Perhatikan karakter yang mencetak di luar boks (misal jika \`)\` sudah ada di luar boks, jangan ditulis ulang di dalam boks). Sintaks harus menyatu utuh dengan lingkungan sekitarnya.
- PERHATIAN: Periksa indeks [KOTAK KOSONG N] dengan hati-hati. Kotak pertama biasanya adalah KONDISI (misal 'y == 10'), lalu kotak berikutnya adalah ISI STATEMENT. Jangan sampai isi statement tertukar ke kotak kondisi! Penuhi seluruh array dari indeks 0 hingga habis.

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
  for (const pattern of patterns) {
    const match = searchArea.match(pattern) || text.match(pattern);
    if (match) {
      let parsed = attemptParse(match[1]) ?? attemptParse(fixInvalidJson(match[1]));
      if (Array.isArray(parsed) && parsed.length > 0) { parsedArray = parsed; break; }
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
    parsedArray.forEach(ans => {
      if (ans.type === "coding" || ans.type === "essay" || ans.jawaban === "TERPISAH") {
        const tagRegex = new RegExp(
          `===JAWABAN_${ans.index}===([\\s\\S]*?)===AKHIR_JAWABAN_${ans.index}===`, "i"
        );
        const externalMatch = text.match(tagRegex);
        if (externalMatch) {
          let raw = externalMatch[1].trim();
          raw = raw.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
          ans.jawaban = raw;
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

  // Channel 1: Direct message
  try {
    await chrome.tabs.sendMessage(lmsTabId, { type: "PRELAB_ANSWERS", answers });
    delivered = true;
  } catch { }

  // Channel 2: scripting.executeScript — ONLY if Channel 1 failed (prevents double handleAnswers call)
  if (!delivered) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: lmsTabId },
        func: (answersJson) => {
          if (typeof window.__prelabFill === "function") {
            window.__prelabFill(answersJson);
          } else {
            window.__prelabPendingAnswers = answersJson;
          }
        },
        args: [answers],
      });
      delivered = true;
    } catch { }
  }

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
    ],
  }).then(tabs => {
    tabs.forEach(tab =>
      chrome.tabs.sendMessage(tab.id, { type: "PRELAB_STATUS_UPDATE", data }).catch(() => { })
    );
  });
}
