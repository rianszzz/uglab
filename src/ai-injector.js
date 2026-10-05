// ai-injector.js — UGLab AI Automation Script

(function () {
  "use strict";

  let isProcessing = false;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

    let prompt = `Kamu adalah asisten akademik ahli dengan kemampuan matematika, logika, dan pemrograman tingkat tinggi. Jawab soal berikut dengan keakuratan >99%.

${extraPrompt ? `Instruksi Tambahan dari Pengguna: ${extraPrompt}\n\n` : ""}
=== PROSES WAJIB (CHAIN OF THOUGHT) ===
Tuliskan SELURUH langkah penyelesaian di dalam tag <ANALISIS>...</ANALISIS> SEBELUM menulis JSON.
TIDAK BOLEH lewati <ANALISIS> — bahkan untuk soal pilihan ganda sekalipun. Akurasi lebih penting dari kecepatan.

Format output:
<ANALISIS>
[Tulis semua proses perhitungan di sini, soal per soal]
</ANALISIS>
\`\`\`json
[array JSON jawaban]
\`\`\`

Format JSON:
[
  {
    "index": 0,
    "type": "multichoice",
    "jawaban": "teks jawaban yang dipilih",
    "index_pilihan": 0
  }
]

Field:
- "index": nomor urut soal (mulai 0)
- "type": tipe soal
- "jawaban": teks lengkap opsi yang dipilih (salin PERSIS dari pilihan)
- "index_pilihan": nomor urut opsi 0-based; array untuk multi-select; null untuk coding/essay

Soal-soal yang perlu dijawab:

`;

    questions.forEach((q, i) => {
      const typeName = typeMap[q.type] || q.type;
      prompt += `--- Soal ${i + 1} (index: ${q.index}, tipe: ${typeName}) ---\n`;
      prompt += `${q.text}\n`;

      if (q.options && q.options.length) {
        prompt += "Pilihan:\n";
        q.options.forEach((opt, j) => {
          prompt += `[Opsi ${j}]:\n${opt.text}\n\n`;
        });
      }

      if (q.type === "coding") {
        prompt += "(Berikan kode lengkap yang dapat dijalankan)\n";
      }

      if (q.images && q.images.length > 0) {
        prompt += `[Soal ini memiliki ${q.images.length} gambar yang dilampirkan]\n`;
        if (q.text.includes("[GAMBAR")) {
          prompt += "Keterangan: Label [GAMBAR N] pada teks di atas merujuk pada gambar ke-N yang dilampirkan (urut dari pertama).\n";
        }
      }

      // NEW: Specific instructions for Dropdown Boxes in multifill/match
      if (q.dropdownOptions) {
        prompt += "\nPilihan untuk setiap kotak (WAJIB memilih salah satu): \n";
        q.dropdownOptions.forEach(box => {
          prompt += `- Kotak ${box.index}: [${box.options.join(", ")}]\n`;
        });
      } else if (q.type === "match" && q.options) {
        prompt += "\nPilihan Jawaban (WAJIB memilih dari list ini):\n";
        const optList = q.options.map(o => o.text).join(", ");
        prompt += optList + "\n";
        
        // Hint for Graph identification if options look like graph types
        if (optList.toLowerCase().includes("graph")) {
          prompt += "\nHint Analisis (IDENTIFIKASI GRAPH):\n";
          prompt += "- Perhatikan baik-baik SEMUA GAMBAR sebelum memasangkan.\n";
          prompt += "- Weighted Graph: Memiliki angka beban/bobot di setiap garis/sisi antar node.\n";
          prompt += "- Directed Graph: Memiliki panah (arah) pada garis hubungnya.\n";
          prompt += "- Undirected Graph: Hanya garis lurus TANPA mata panah dan TANPA angka beban.\n";
          prompt += "- Acyclic Directed Graph (DAG): Directed graph yang tidak memiliki sirkuit/loop kembali ke titik asal.\n";
          prompt += "- Labelled Vertex: Titik (node) memiliki label HANYA berupa huruf alfabet (A, B, C, dst). JIKA NODE BERUPA ANGKA (1, 2, 3), MAKA ITU BUKAN LABELLED VERTEX!\n";
        }
      }

      // Himpunan Edge / Edge Set
      if (q.text.toLowerCase().includes("himpunan edge")) {
        prompt += "\nHint Analisis (HIMPUNAN EDGE):\n";
        prompt += "- Periksa apakah garis pada graf memiliki panah (Directed) atau tidak (Undirected).\n";
        prompt += "- JIKA UNDIRECTED: Garis antara node 1 dan 2 berarti edge (1,2) ATAU (2,1). Keduanya adalah sisi yang sama. Himpunan edge tidak memperhatikan urutan indeks dalam pasangan.\n";
        prompt += "- JIKA DIRECTED: Panah dari node 1 menuju 2 HANYA dapat ditulis sebagai edge (1,2).\n";
        prompt += "- Pilih opsi jawaban yang paling tepat secara keseluruhan set.\n";
      }

      prompt += "\n";
    });

    prompt += `\n=== ATURAN AKURASI WAJIB ===

KHUSUS MATEMATIKA & MATRIKS (WAJIB hitung manual di <ANALISIS>):
- TRANSPOSE A^T: elemen (i,j) menjadi (j,i). Baris jadi kolom. Contoh: [[1,2],[3,4]]^T = [[1,3],[2,4]].
- INVERS 2×2: [[a,b],[c,d]]^-1 = 1/(ad-bc) × [[d,-b],[-c,a]]. Hitung det dulu, lalu tukar diagonal & negasikan off-diagonal.
- KOFAKTOR C_ij = (-1)^(i+j) × M_ij, M_ij = det minor (hapus baris-i kolom-j).
- DETERMINAN 3×3: Ekspansi kofaktor baris 1. Pola tanda: + - + / - + - / + - +
- WAJIB VERIFIKASI: Substitusi nilai balik ke soal. Hitung ulang jika tidak cocok dengan opsi.

DETEKSI JEBAKAN:
- True/False: kata "selalu/semua/tidak pernah/pasti" hampir selalu SALAH. Cari kontraeksempel.
- Pilihan Ganda: eliminasi yang jelas salah, lalu hitung/verifikasi sisanya.
- Perbandingan angka: hitung digit ribuan/desimal dengan sangat teliti.
`;

    prompt += `\nInstruksi Format Keluaran:
1. Kembalikan array JSON berisi profil jawaban, DIPISAHKAN DENGAN tag kode khusus untuk soal essay/coding.
2. UNTUK OPSI GANDA BIASA (Radio): Tulis teks jawaban di "jawaban", dan isi "index_pilihan" dengan angka urutannya (0, 1, 2...).
3. UNTUK CHECKBOX MULTIPLE-CHOICE (Pilih Satu atau Lebih): Isi "index_pilihan" berupa ARRAY dari angka index pilihan yang benar (contoh: [0, 2, 3]). Jangan gunakan angka tunggal!
4. UNTUK ISIAN BANYAK KOTAK (multifill): Anda akan menjumpai teks penanda [KOTAK KOSONG 0], [KOTAK KOSONG 1], dan seterusnya pada teks soal. Evaluasi/hitung jawaban untuk masing-masing posisi tersebut berdasarkan konteks kalimat di sekitarnya, lalu kembalikan hasilnya pada field "jawaban" berupa ARRAY of string berurutan. WAJIB mengembalikan array dari teks hasil akhirnya secara harfiah (LITERAL) tanpa menyebutkan label kotaknya lagi! Contoh: "jawaban": ["2", "2.54648", "2", "2.66666..."]
5. UNTUK ESSAY ATAU CODING: JANGAN tulis jawaban panjang di dalam JSON! Di dalam JSON, set "jawaban": "TERPISAH". 
   Lalu, tepat di LUAR JSON, tuliskan JAWABAN LENGKAP (untuk essay) atau KODE (untuk coding) diapit oleh penanda ===JAWABAN_N=== dan ===AKHIR_JAWABAN_N=== (tanpa markdown backticks).
   - KHUSUS ESSAY: Jawaban HARUS SINGKAT, PADAT, DAN CEPAT (maks. 1-2 paragraf komprehensif) tanpa basa-basi.
   - KHUSUS CODING: Tuliskan HANYA MURNI KODE yang dapat dijalankan tanpa penjelasan tambahan.
6. UNTUK SOAL DROP DOWN / MATCHING: Jika tersedia "Pilihan" atau "Pilihan untuk setiap kotak", maka isi "jawaban" berupa ARRAY of string yang berisi teks PILIHAN YANG DIPILIH secara harfiah (LITERAL). Jangan mengubah teks pilihan tersebut (termasuk simbol Rp, titik, koma, dsb).
Contoh:
\`\`\`json
[
  { "index": 0, "type": "coding", "jawaban": "TERPISAH", "index_pilihan": null },
  { "index": 1, "type": "essay", "jawaban": "TERPISAH", "index_pilihan": null },
  { "index": 2, "type": "multifill", "jawaban": ["2", "2.54648"], "index_pilihan": null }
]
\`\`\`
===JAWABAN_0===
import java.util.Scanner;
public class SapaDunia {
   public static void main(String[] args) {
       System.out.println("Hello, World!");
   }
}
===AKHIR_JAWABAN_0===
===JAWABAN_1===
Integrasi nasional sangat penting bagi negara baru berkembang karena dapat menyatukan berbagai elemen bangsa yang memiliki perbedaan suku, agama, dan budaya untuk membentuk satu kesatuan identitas nasional yang utuh.
===AKHIR_JAWABAN_1===

7. PENTING: Untuk jawaban tipe CODING, DILARANG KERAS MENAMBAH PENJELASAN ATAU KATA-KATA APAPUN DI DALAM PENANDA ===JAWABAN_N===! HANYA KODE MURNI.

8. PENTING - SOAL KODING TEMPLATE: Jika soal menautkan [TEMPLATE KODE AWAL DARI DOSEN], Anda WAJIB meniru penempatan contoh riel berikut ini secara persis!
   CONTOH PENGISIAN YANG BENAR:
   --- Awal Template Dosen ---
   // [1] Import class Scanner

   /* Program ini menghitung akar */
   public class PersamaanKuadrat {
       public static void main(String[] args) {
           // [2] Deklarasikan a, b, c untuk menyimpan input pengguna
       }
   }
   --- Hasil Jawaban Anda di dalam penanda ===JAWABAN_N=== ---
   import java.util.Scanner; // [1] Import class Scanner

   /* Program ini menghitung akar */
   public class PersamaanKuadrat {
       public static void main(String[] args) {
           // [2] Deklarasikan a, b, c untuk menyimpan input pengguna
           double a, b, c;
       }
   }
   -------------------------------------------------
   Ikuti pola di atas! JANGAN menghapus komentar aslinya. Kembalikan struktur utuhnya hingga kurung penutup terakhir!

9. KESESUAIAN OUTPUT MENGHADAPI MOODLE GRADER (99% AKURASI): 
   - Moodle grader sering menggunakan literal string match. Jika soal meminta hasil output Java/C++/Python, hitunglah PERSIS seperti runtime bahasa tersebut.
   - PRESISI DESIMAL: Jangan membulatkan angka desimal kecuali diperintahkan! Jika Java mencetak "2.6666666666666665", tuliskan SEBANYAK itu. Jangan diringkas jadi "2.67".
   - PROMPT/PREFIX: Tangkap seluruh kata sebelum input. Jika contoh menampilkan "Masukkan angka: 10", pastikan kode Anda mencetak "Masukkan angka: " (ada spasi di ujung).
   - CASING & PUNCTUATION: "Hello World" berbeda dengan "hello world!". Perhatikan huruf besar/kecil dan tanda baca secara fanatik!
   - SOAL MATEMATIKA: Jika soal menggunakan notasi matematika (fraksi/integral), berikan jawaban dalam format teks bersih yang mudah dipahami (misal: "A/x + B/(x+5)^2"). Gunakan '^' untuk pangkat dan '/' untuk pembagian.
   - JANGAN ada penjelasan tambahan/analisis di luar format yang diminta. Fokus 100% pada akurasi jawaban akhir.

10. ATURAN KHUSUS LOKAL INDONESIA (PENTING):
   - Gunakan format angka Indonesia: Titik (.) sebagai pemisah ribuan, Koma (,) sebagai pemisah desimal.
   - Contoh: "Rp 717.500.000" berarti tujuh ratus tujuh belas juta. "5,44" berarti lima koma empat empat (rata-rata).
   - HATI-HATI: Jangan tertukar antara ribuan dan desimal!

11. ANALISIS PERBANDINGAN WAJIB (ACCURACY >99%):
   - Di dalam <ANALISIS>, buat daftar semua opsi yang tersedia untuk setiap kotak dropdown.
    - Bandingkan pilihan Anda dengan SEMUA angka lain di daftar. Jika mencari nilai "Tertinggi", pastikan pilihan Anda adalah yang terbesar secara numerik. Jika mencari "Terendah", pastikan tidak ada angka lain yang lebih kecil.
    - Untuk mata uang, hitung jumlah digit nol dengan sangat teliti. Perbedaan satu titik bisa berakibat fatal (Rp 7.000.000 vs Rp 700.000.000).
    - Logika Plausibilitas: Total biasanya nilai terbesar, Rata-rata biasanya desimal, Nilai urutan (1, 2, 3) biasanya untuk peringkat.

12. DETEKSI JEBAKAN & INTEGRITAS KONSEPTUAL (PENTING):
    - Untuk soal Benar/Salah (True/False): Waspadai kata-kata pengecoh atau "Trick Questions". Analisis setiap kata dengan kritis!
    - Definisi Formal: Periksa apakah ada kesalahan pada terminologi dasar. (Contoh: "Minimax 1 player" adalah SALAH karena Minimax butuh 2 player adversarial; "Random" sering kali sebenarnya pseudo-random).
    - Kata Kunci Absolut: Jika ada kata "Selalu", "Semua", "Hanya", "Pasti", "Tidak Pernah", lakukan verifikasi ekstra. Seringkali satu pengecualian kecil membuat pernyataan menjadi SALAH.
    - Konteks Akademik: Gunakan definisi formal standar dari kurikulum perguruan tinggi (Praktikum). Jangan gunakan asumsi bahasa sehari-hari.
    - Jika ada dua pernyataan dalam satu soal, evaluasi keduanya secara terpisah sebelum menentukan jawaban akhir.
`;
    return prompt;
  }

  // ─── Inject to Web Engine (Gemini & ChatGPT) ──────────────────────────────────
  async function injectToWebEngine(payload) {
    const { questions = [], extraPrompt = "", requestId = "manual" } = payload;
    try {
      const allInputSelectors = [
        "div[aria-label='Konteks chat'][contenteditable='true']",
        "div[aria-label='Chat context'][contenteditable='true']",
        "div[contenteditable='true'].ql-editor",
        "rich-textarea .ql-editor",
        "rich-textarea [contenteditable=true]",
        ".ql-editor[contenteditable=true]",
        "p[data-placeholder]",
        "#prompt-textarea",
        "[data-testid='chat-input']",
        ".ProseMirror[contenteditable='true']"
      ];

      const inputEl = await new Promise((resolve, reject) => {
        const check = () => {
          for (const sel of allInputSelectors) {
            const el = document.querySelector(sel);
            if (el) return el;
          }
          return null;
        };
        const el = check();
        if (el) return resolve(el);

        const obs = new MutationObserver(() => {
          const found = check();
          if (found) { obs.disconnect(); resolve(found); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
          obs.disconnect();
          reject(new Error("Gagal menemukan kotak input Gemini (UI mungkin berubah/belum login)."));
        }, 12000);
      });

      const promptText = buildPrompt(questions, extraPrompt);

      // ── Image Handling (Paste Strategy) ──────────────────────────────────────
      const images = payload.images || [];
      if (images.length > 0) {
        console.log(`[UGLab] Menyiapkan ${images.length} gambar untuk dipot...`);
        for (const base64 of images) {
          try {
            const blob = await (await fetch(`data:image/jpeg;base64,${base64}`)).blob();
            const item = new ClipboardItem({ "image/png": blob });
            await navigator.clipboard.write([item]);
            inputEl.focus();
            document.execCommand("paste");
            await sleep(800); // Tunggu upload selesai
          } catch (e) {
            console.error("[UGLab] Gagal paste gambar:", e);
          }
        }
      }

      // ── Clear and inject text ────────────────────────────────────────────────
      inputEl.focus();
      await sleep(100);

      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      await sleep(50);

      // Method 1: Real Clipboard Paste (Sangat ampuh & Anti-Blokir untuk ProseMirror/Claude)
      let injected = false;
      try {
        await navigator.clipboard.writeText(promptText);
        inputEl.focus();
        document.execCommand("paste");
        await sleep(300);
        injected = !!inputEl.innerText.trim();
      } catch (e) {
        console.warn("[UGLab] Clipboard Paste gagal:", e);
      }

      // Method 2: Fallback insertText
      if (!injected) {
        const inserted = document.execCommand("insertText", false, promptText);
        if (!inserted || !inputEl.innerText.trim()) {
          // Jika semua gagal, paksa ubah HTML internalnya (meski berisiko state ProseMirror rusak)
          if (inputEl.querySelector("p")) {
            inputEl.querySelector("p").innerText = promptText;
          } else {
            inputEl.innerText = promptText;
          }
        }
      }

      // Trigger all possible events to enable the Send button (Reactive UI)
      ["input", "change", "keyup", "keydown"].forEach(evtName => {
        inputEl.dispatchEvent(new Event(evtName, { bubbles: true }));
      });
      
      await sleep(500);

      // ── Find and click send button ───────────────────────────────────────────
      let sendBtn = null;
      for (let i = 0; i < 20; i++) {
        const candidates = [
          document.querySelector("button[jsname='FBnT4']"), // Specific Google/Gemini Send Button
          document.querySelector("button[aria-label*='Kirim pesan']"),
          document.querySelector("button[aria-label*='Send message']"),
          document.querySelector(".send-button-container button"),
          ...Array.from(document.querySelectorAll("button")).filter(b => {
             const label = (b.getAttribute("aria-label") || "").toLowerCase();
             const isSend = label.includes("send") || label.includes("kirim");
             if (!isSend) return false;
             
             // ANTI-MISCLICK: Hindari tombol yang berada di top-left (biasanya Menu)
             const rect = b.getBoundingClientRect();
             if (rect.top < 100 && rect.left < 100) return false;
             
             return true;
          })
        ].filter(b => b && !b.disabled && b.getAttribute("aria-disabled") !== "true");

        if (candidates.length) { 
          sendBtn = candidates[0]; 
          break; 
        }
        
        // Trigger manual input events to wake up the Send button
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(400);
      }

      if (!sendBtn) throw new Error("Tombol send tidak ditemukan atau masih terkunci.");

      // Find the number of existing responses BEFORE sending to correctly detect the NEW response stream
      const getResponseEls = () => {
        for (const sel of ["model-response", "[data-message-author-role='assistant']", ".message.model", ".prose", ".font-claude-message"]) {
          const els = document.querySelectorAll(sel);
          if (els.length > 0) return Array.from(els);
        }
        return [];
      };
      const initialResponseCount = getResponseEls().length;

      sendBtn.click();
      console.log("[UGLab] Send button clicked, waiting for response. Initial count:", initialResponseCount);

      // ── Wait for AI to respond + extract ─────────────────────────────────
      await waitAndExtractResponse(requestId, questions.length, payload.lmsTabId, initialResponseCount);

    } catch (err) {
      chrome.runtime.sendMessage({
        type: "GEMINI_ERROR",
        requestId: payload.requestId,
        error: err.message,
      });
    }
  }

  // ─── Find Best Response Element ───────────────────────────────────────────────
  // Simple approach: look for elements with enough text, skip tiny sidebar items.
  // No mat-sidenav filtering (it wraps the whole page in Angular Material!).
  function findBestResponseElement() {
    const selectors = [
      // Gemini
      "model-response",
      "message-content",
      "ms-text-chunk",
      "model-response .markdown",
      // ChatGPT
      ".markdown",
      ".prose",
      "[data-message-author-role='assistant']",
      // Claude
      ".font-claude-message",
      // Fallbacks
      "[data-message-id]",
    ];

    for (const sel of selectors) {
      const els = Array.from(document.querySelectorAll(sel))
        .filter(el => (el.innerText || "").trim().length > 10);
      if (els.length) {
        return els[els.length - 1]; // last = most recent
      }
    }
    return null;
  }

  // ─── Wait + Extract (text-stability approach) ─────────────────────────────────
  // Instead of reading loading indicators or stop-button state (which vary by
  // UI version), we watch if the response text STOPS GROWING for 3 consecutive
  // seconds. This is completely agnostic to Gemini's internal DOM structure.
  async function waitAndExtractResponse(requestId, questionCount, lmsTabId, initialCount) {
    const getResponseCount = () => {
      for (const sel of ["model-response", "[data-message-author-role='assistant']", ".message.model", ".prose", ".font-claude-message"]) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) return els.length;
      }
      return 0;
    };

    // Phase 1 — wait for any response to START (up to 30s)
    const phase1Deadline = Date.now() + 30000;
    while (Date.now() < phase1Deadline) {
      const stopBtn = document.querySelector(
        "button[aria-label='Stop generating'], button[aria-label='Hentikan pembuatan'], button[aria-label='Stop responding'], button[data-testid='stop-button']"
      );
      if (stopBtn) break; // streaming started

      if (getResponseCount() > initialCount) {
        break; // new response container appeared!
      }

      await sleep(700);
    }

    console.log("[UGLab] Response started, waiting for stability...");

    // Phase 2 — wait for streaming to STOP (text-length stable for 3 rounds)
    const phase2Deadline = Date.now() + 120000;
    let lastLen = 0;
    let stableRounds = 0;

    while (Date.now() < phase2Deadline) {
      const el = findBestResponseElement();
      const currentLen = el?.innerText?.length ?? 0;

      const stopBtn = document.querySelector(
        "button[aria-label='Stop generating'], button[aria-label='Hentikan pembuatan'], button[aria-label='Stop responding'], button[data-testid='stop-button']"
      );

      // Aggressive Early Exit Strategy (MAXIMUM SPEED)
      // Check if we can parse the JSON and all required closing tags exist
      if (currentLen > 50) {
         const tempAnswers = parseAnswersFromText(el?.innerText || "", questionCount);
         if (tempAnswers && tempAnswers.length > 0) {
            let allTagsSatisfied = true;
            for (const ans of tempAnswers) {
               if (ans.type === "coding" || ans.type === "essay" || ans.jawaban === "TERPISAH") {
                  if (!(el?.innerText || "").includes(`===AKHIR_JAWABAN_${ans.index}===`)) {
                     allTagsSatisfied = false;
                     break;
                  }
               }
            }
            if (allTagsSatisfied) {
               console.log("[UGLab] Valid JSON and all texts found! Aggressive early exit!");
               break;
            }
         }
      }

      if (currentLen > 0 && currentLen === lastLen) {
        stableRounds++;
        if (stableRounds >= 4 || (stableRounds >= 3 && !stopBtn)) {
          console.log("[UGLab] Text stable — streaming complete.");
          break;
        }
      } else {
        stableRounds = 0;
      }
      lastLen = currentLen;
      await sleep(800);
    }

    await sleep(800); // final render buffer
    await extractAndRelayResponse(requestId, questionCount, lmsTabId);
  }

  // ─── Extract JSON and Deliver to LMS ─────────────────────────────────────────
  async function extractAndRelayResponse(requestId, questionCount, lmsTabId) {
    // ── Strategy A: targeted element selectors (last element wins) ────────────
    const responseSelectors = [
      "model-response", "message-content", "ms-text-chunk",
      "model-response .markdown", ".markdown", ".prose",
      "[data-message-author-role='assistant']",
      "[data-message-id]", ".message.model",
    ];

    let rawText = "";

    for (const sel of responseSelectors) {
      const els = Array.from(document.querySelectorAll(sel))
        .filter(el => (el.innerText || "").trim().length > 10);
      if (els.length) {
        rawText = els[els.length - 1].innerText || "";
        console.log("[UGLab] Got text via selector:", sel, "| length:", rawText.length);
        break;
      }
    }

    // ── Strategy B: TreeWalker — scan all text nodes for JSON ─────────────────
    if (!rawText || !rawText.includes('"jawaban"')) {
      const candidates = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const t = node.textContent.trim();
        if (t.includes('"jawaban"') || (t.startsWith("[") && t.includes('"index"'))) {
          candidates.push(t);
        }
      }
      if (candidates.length) {
        rawText = candidates[candidates.length - 1];
        console.log("[UGLab] Got text via TreeWalker | length:", rawText.length);
      }
    }

    if (!rawText) {
      chrome.runtime.sendMessage({
        type: "GEMINI_ERROR", requestId,
        error: "Tidak bisa menemukan teks respons di halaman Gemini.",
      });
      return;
    }

    // ── Parse JSON from text ──────────────────────────────────────────────────
    let answers = parseAnswersFromText(rawText, questionCount);

    // Retry once with whole page text if still not found
    if (!answers) {
      await sleep(2000);
      const retryEls = Array.from(document.querySelectorAll(
        "model-response, message-content, ms-text-chunk"
      )).filter(el => (el.innerText || "").length > 10);
      if (retryEls.length) {
        answers = parseAnswersFromText(retryEls[retryEls.length - 1].innerText || "", questionCount);
      }
    }

    if (!answers) {
      chrome.runtime.sendMessage({
        type: "GEMINI_ERROR", requestId,
        error: "Gagal parse JSON. Respons: " + rawText.slice(0, 300),
      });
      return;
    }

    console.log("[UGLab] Parsed answers, delivering to LMS tab", lmsTabId);

    // ── Deliver raw text to background for parsing & delivery ──────────────────
    chrome.runtime.sendMessage({ 
      type: "GEMINI_DONE", 
      data: { text: rawText, requestId } 
    });

    // Provide feedback on the Gemini page
    showGeminiOverlay("✅ Jawaban terkirim! Mengalihkan...");
  }


  function parseAnswersFromText(text, questionCount) {
    // Helper to fix common Gemini JSON formatting mistakes (like unescaped quotes)
    const fixInvalidJson = (str) => {
      let fixed = str
        // Fix ""Text"" -> "\"Text\""
        .replace(/""([^"]*)""/g, '"\\"$1\\""')
        // Fix invalid escape characters (e.g. C:\user\documents -> C:\\user\\documents)
        // Matches '\' that is NOT followed by valid JSON escape chars (", \, /, b, f, n, r, t, uXXXX)
        .replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\');

      // Fix unescaped middle quotes inside "jawaban" specifically
      fixed = fixed.replace(/("jawaban"\s*:\s*")([\s\S]*?)("\s*,\s*"index_pilihan"\s*:|"\s*})/g, (match, start, content, end) => {
        const fixedContent = content.replace(/(?<!\\)"/g, '\\"');
        return start + fixedContent + end;
      });

      // Catch any physical newlines inside the "jawaban" field
      fixed = fixed.replace(/("jawaban"\s*:\s*")([\s\S]*?)("\s*,\s*"index_pilihan"\s*:|"\s*})/g, (match, start, content, end) => {
        const fixedContent = content.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
        return start + fixedContent + end;
      });

      return fixed;
    };

    const attemptParse = (str) => {
      try { return JSON.parse(str); } catch (e) { return null; }
    };

    // Try to extract JSON array — strip reasoning tags first
    let searchArea = text;
    if (text.includes("</KERJA>")) {
      searchArea = text.split("</KERJA>").pop();
    } else if (text.includes("</ANALISIS>")) {
      searchArea = text.split("</ANALISIS>").pop();
    }

    const patterns = [
      /```json\s*(\[[\s\S]*?\])\s*```/,
      /```\s*(\[[\s\S]*?\])\s*```/,
      /(\[\s*\{\s*"index"[\s\S]*\}\s*\])/, // Structured detection
      /(\[[\s\S]*"jawaban"[\s\S]*\])/,
    ];

    let parsedArray = null;
    for (const pattern of patterns) {
      const match = searchArea.match(pattern) || text.match(pattern);
      if (match) {
        let parsed = attemptParse(match[1]);
        if (!parsed) parsed = attemptParse(fixInvalidJson(match[1]));

        if (Array.isArray(parsed) && parsed.length > 0) {
          parsedArray = parsed;
          break;
        }
      }
    }

    if (!parsedArray) {
      const trimmed = text.trim();
      if (trimmed.startsWith("[")) {
        let parsed = attemptParse(trimmed);
        if (!parsed) parsed = attemptParse(fixInvalidJson(trimmed));
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsedArray = parsed;
        }
      }
    }

    // Secondary parsing: Extract Out-of-Bounds text block strings and sew them back
    if (parsedArray) {
      parsedArray.forEach(ans => {
        if (ans.type === "coding" || ans.type === "essay" || ans.jawaban === "TERPISAH") {
          const tagRegex = new RegExp(`===JAWABAN_${ans.index}===([\\s\\S]*?)===AKHIR_JAWABAN_${ans.index}===`, "i");
          const externalMatch = text.match(tagRegex);
          if (externalMatch) {
            let rawText = externalMatch[1].trim();
            // Just in case AI still wraps it in markdown backticks
            rawText = rawText.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
            ans.jawaban = rawText;
          }
        }
      });
      return parsedArray;
    }

    return null;
  }

  // ─── Main Entry ───────────────────────────────────────────────────────────────
  async function checkForPendingWork() {
    if (isProcessing) return;

    try {
      const res = await chrome.runtime.sendMessage({ type: "GEMINI_READY" });
      if (res?.payload && !isProcessing) {
        isProcessing = true;
        showGeminiOverlay("⚡ UGLab sedang memproses soal...");
        await injectToWebEngine(res.payload);
        isProcessing = false;
        hideGeminiOverlay();
      }
    } catch { }
  }

  // ─── CRITICAL: Direct command listener from background.js (used when tab already exists) ───
  // Background sends only the requestId (NOT the full payload with images) for speed.
  // We fetch the payload from chrome.storage.local ourselves.
  async function doWorkWithRequestId(requestId) {
    // Force reset isProcessing — stale state from a previous run must never block a new request
    if (isProcessing) {
      console.warn("[UGLab] Forcing reset of isProcessing for new request:", requestId);
      isProcessing = false;
    }

    try {
      const data = await chrome.storage.local.get("prelab_pending_payload");
      const payload = data.prelab_pending_payload;
      if (!payload) {
        chrome.runtime.sendMessage({ type: "GEMINI_ERROR", requestId, error: "Payload tidak ditemukan di storage." });
        return;
      }
      isProcessing = true;
      showGeminiOverlay("⚡ UGLab sedang memproses soal...");
      await injectToWebEngine(payload);
    } catch (e) {
      chrome.runtime.sendMessage({ type: "GEMINI_ERROR", requestId, error: e.message });
    } finally {
      isProcessing = false;
      hideGeminiOverlay();
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "PRELAB_DO_WORK") {
      const requestId = msg.requestId;
      if (!requestId) {
        sendResponse({ ok: false, reason: "no requestId" });
        return false;
      }
      // Acknowledge immediately so background stops retrying
      sendResponse({ ok: true });
      doWorkWithRequestId(requestId);
      return false;
    }
  });

  // ─── Gemini Overlay UI ────────────────────────────────────────────────────────
  function showGeminiOverlay(text) {
    let overlay = document.getElementById("prelab-gemini-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "prelab-gemini-overlay";
      overlay.style.cssText = `
        position: fixed; top: 16px; right: 16px; z-index: 999999;
        background: rgba(10, 10, 20, 0.9); backdrop-filter: blur(20px);
        border: 1px solid rgba(0, 255, 149, 0.4); border-radius: 14px;
        padding: 12px 18px; color: #00ff95;
        font-family: 'Segoe UI', monospace; font-size: 13px; font-weight: 600;
        box-shadow: 0 8px 32px rgba(0, 255, 149, 0.2);
        display: flex; align-items: center; gap: 10px;
        animation: prelabFadeIn 0.3s ease;
      `;
      document.body.appendChild(overlay);

      const style = document.createElement("style");
      style.textContent = `@keyframes prelabFadeIn { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }`;
      document.head.appendChild(style);
    }
    overlay.innerHTML = `<span style="animation:spin 1s linear infinite;display:inline-block">⟳</span> ${text}`;
  }

  function hideGeminiOverlay() {
    const overlay = document.getElementById("prelab-gemini-overlay");
    if (overlay) {
      overlay.style.opacity = "0";
      setTimeout(() => overlay.remove(), 300);
    }
  }

  // Check if we are on an AI chat page
  const isAIPage = location.hostname.includes("gemini.google.com") ||
    location.hostname.includes("chatgpt.com") ||
    location.hostname.includes("claude.ai");

  // Start checking when page loads
  if (isAIPage) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => setTimeout(checkForPendingWork, 0));
    } else {
      setTimeout(checkForPendingWork, 0);
    }

    // Also listen for navigation events (SPA)
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(checkForPendingWork, 0);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

})();
