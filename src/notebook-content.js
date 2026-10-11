// notebook-content.js — UGLab Google Colab & Jupyter Notebook Content Script
// Supports: Google Colab (.colab-research / colab.google) & Jupyter (Lab/Notebook/try-jupyter)

(function () {
  "use strict";

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function isColab() {
    return location.hostname.includes("colab.research.google.com") || location.hostname.includes("colab.google");
  }

  function isJupyter() {
    return location.hostname.includes("jupyter") || location.port === "8888" || location.port === "8889";
  }

  // ─── Scrape Exercise Cells ───────────────────────────────────────────────────
  function scrapeNotebookQuestions() {
    const questions = [];

    if (isColab()) {
      const cells = Array.from(document.querySelectorAll(".cell"));
      let qIndex = 0;

      cells.forEach((cell, idx) => {
        const text = (cell.innerText || "").trim();
        // Ciri soal praktikum: # CODE HERE atau <...> atau # ...
        if (text.includes("# CODE HERE") || text.includes("<...>") || text.includes("# ...")) {
          // Cari konteks dari cell markdown/teks sebelumnya jika ada
          let context = "";
          for (let p = Math.max(0, idx - 2); p < idx; p++) {
            const prevText = (cells[p].innerText || "").trim();
            if (prevText && !prevText.includes("# CODE HERE")) {
              context += prevText.slice(0, 300) + "\n";
            }
          }

          questions.push({
            index: qIndex++,
            cellIndex: idx,
            type: "coding",
            text: `[Konteks Modul]:\n${context}\n\n[Kode Soal]:\n${text}`,
            rawCode: text,
            cellElement: cell
          });
        }
      });
    } else if (isJupyter()) {
      const cells = Array.from(document.querySelectorAll(".jp-Cell, .cell"));
      let qIndex = 0;

      cells.forEach((cell, idx) => {
        const text = (cell.innerText || "").trim();
        if (text.includes("# CODE HERE") || text.includes("<...>") || text.includes("# ...")) {
          let context = "";
          for (let p = Math.max(0, idx - 2); p < idx; p++) {
            const prevText = (cells[p].innerText || "").trim();
            if (prevText && !prevText.includes("# CODE HERE")) {
              context += prevText.slice(0, 300) + "\n";
            }
          }

          questions.push({
            index: qIndex++,
            cellIndex: idx,
            type: "coding",
            text: `[Konteks Modul]:\n${context}\n\n[Kode Soal]:\n${text}`,
            rawCode: text,
            cellElement: cell
          });
        }
      });
    }

    return questions;
  }

  // ─── Fill & Run Notebook Cells ───────────────────────────────────────────────
  async function fillNotebookAnswers(answers) {
    if (!answers || !answers.length) return;

    if (isColab()) {
      // Di Google Colab, model Monaco aktif dapat diakses via window.monaco atau interaksi DOM
      const models = typeof window.monaco !== "undefined" ? window.monaco.editor.getModels() : [];
      const cells = Array.from(document.querySelectorAll(".cell"));
      
      // Filter model Monaco yang merupakan code cell soal (dimulai dari model 13 dst)
      const targetModels = models.filter(m => {
        const v = m.getValue();
        return (v.includes("# CODE HERE") || v.includes("<...>")) && !m.uri.toString().endsWith("/1") && !m.uri.toString().endsWith("/9");
      });

      for (let i = 0; i < answers.length; i++) {
        const ans = answers[i];
        let codeAnswer = (typeof ans.jawaban === "string" ? ans.jawaban : "").trim();
        codeAnswer = codeAnswer.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
        if (!codeAnswer) continue;

        // 1. Isi via Monaco model yang berurutan
        const m = targetModels[i];
        if (m) {
          const val = m.getValue();
          let newVal = val.includes("<...>") ? val.replace("<...>", codeAnswer) : val + "\n" + codeAnswer;
          m.setValue(newVal);
        }

        // 2. Trigger Run Button di cell yang bersesuaian
        const targetCell = exerciseCells[i];
        if (targetCell) {
          targetCell.scrollIntoView({ behavior: "smooth", block: "center" });
          await sleep(200);
          const runBtn = targetCell.querySelector("colab-run-button, .cell-execution-container, [aria-label*='Run']");
          if (runBtn) {
            runBtn.click();
            await sleep(500);
          }
        }
      }
    }
  }

  // ─── Chrome Runtime Listener ─────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "PRELAB_PING") {
      sendResponse({ ok: true, url: location.href, isNotebook: true });
      return false;
    }

    if (msg.type === "PRELAB_SCRAPE") {
      const questions = scrapeNotebookQuestions();
      chrome.storage.local.set({ prelab_questions_cache: questions });
      const meta = questions.map(q => ({
        index: q.index,
        type: q.type,
        text: q.text.slice(0, 100),
        hasImages: false
      }));
      sendResponse({ questions: meta, count: questions.length, isNotebook: true });
      return false;
    }

    if (msg.type === "PRELAB_ANSWERS") {
      fillNotebookAnswers(msg.answers).then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }
  });

})();
