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

    let globalContext = "";
    if (isColab()) {
      const nb = (typeof window !== "undefined" && window.colab?.global?.notebook) || (typeof colab !== "undefined" && colab?.global?.notebook);
      if (nb && Array.isArray(nb.cells)) {
        nb.cells.forEach(c => {
          if (c.model?.type === "markdown" || c.model?.type === "text") {
            const t = (c.model?.getText() || "").trim();
            if (t.includes("Instruksi") || t.includes("Overview") || t.includes("Petunjuk") || t.includes("http")) {
              globalContext += t.slice(0, 800) + "\n\n";
            }
          }
        });
        let qIndex = 0;
        nb.cells.forEach((cell, idx) => {
          if (!cell.model || cell.model.type !== "code") return;
          const text = (cell.model.getText() || "").trim();
          if (text.includes("# CODE HERE") || text.includes("<...>") || text.includes("# ...")) {
            let context = "";
            for (let p = Math.max(0, idx - 2); p < idx; p++) {
              const prev = (nb.cells[p]?.model?.getText() || "").trim();
              if (prev && !prev.includes("# CODE HERE")) {
                context += prev.slice(0, 300) + "\n";
              }
            }

            questions.push({
              index: qIndex++,
              cellId: cell.cellId,
              type: "coding",
              globalContext: globalContext.trim(),
              text: `${globalContext ? `[Petunjuk & Modul]:\n${globalContext.trim()}\n\n` : ""}[Konteks Modul]:\n${context}\n\n[Kode Soal]:\n${text}`,
              rawCode: text
            });
          }
        });
        return questions;
      }

      document.querySelectorAll(".cell.markdown, .cell.text, colab-cell.text").forEach(c => {
        const t = (c.innerText || "").trim();
        if (t.includes("Instruksi") || t.includes("Overview") || t.includes("Petunjuk") || t.includes("http")) {
          globalContext += t.slice(0, 800) + "\n\n";
        }
      });
      const cells = Array.from(document.querySelectorAll(".cell.code"));
      let qIndex = 0;

      cells.forEach((cell, idx) => {
        const text = (cell.innerText || "").trim();
        if (text.includes("# CODE HERE") || text.includes("<...>") || text.includes("# ...")) {
          const allCells = Array.from(document.querySelectorAll(".cell"));
          const currentCellPos = allCells.indexOf(cell);
          let context = "";
          for (let p = Math.max(0, currentCellPos - 2); p < currentCellPos; p++) {
            const prevText = (allCells[p].innerText || "").trim();
            if (prevText && !prevText.includes("# CODE HERE")) {
              context += prevText.slice(0, 300) + "\n";
            }
          }

          const cellId = cell.id ? cell.id.replace(/^cell-/, "") : (cell.getAttribute("data-cell-id") || "");
          questions.push({
            index: qIndex++,
            cellId: cellId,
            cellIndex: idx,
            type: "coding",
            globalContext: globalContext.trim(),
            text: `${globalContext ? `[Petunjuk & Modul]:\n${globalContext.trim()}\n\n` : ""}[Konteks Modul]:\n${context}\n\n[Kode Soal]:\n${text}`,
            rawCode: text
          });
        }
      });
    } else if (isJupyter()) {
      document.querySelectorAll(".jp-MarkdownCell, .cell.text").forEach(c => {
        const t = (c.innerText || "").trim();
        if (t.includes("Instruksi") || t.includes("Overview") || t.includes("Petunjuk") || t.includes("http")) {
          globalContext += t.slice(0, 800) + "\n\n";
        }
      });
      const cells = Array.from(document.querySelectorAll(".jp-Cell, .cell"));
      let qIndex = 0;

      cells.forEach((cell, idx) => {
        const text = (cell.querySelector(".cm-content")?.innerText || cell.innerText || "").trim();
        if (text.includes("# CODE HERE") || text.includes("<...>") || text.includes("# ...")) {
          let context = "";
          for (let p = Math.max(0, idx - 2); p < idx; p++) {
            const prevText = (cells[p].querySelector(".cm-content")?.innerText || cells[p].innerText || "").trim();
            if (prevText && !prevText.includes("# CODE HERE")) {
              context += prevText.slice(0, 300) + "\n";
            }
          }

          const cellId = cell.id ? cell.id.replace(/^cell-/, "") : (cell.getAttribute("data-cell-id") || "");
          questions.push({
            index: qIndex++,
            cellId: cellId,
            cellIndex: idx,
            type: "coding",
            globalContext: globalContext.trim(),
            text: `${globalContext ? `[Petunjuk & Modul]:\n${globalContext.trim()}\n\n` : ""}[Konteks Modul]:\n${context}\n\n[Kode Soal]:\n${text}`,
            rawCode: text
          });
        }
      });
    }

    return questions;
  }

  function replaceCode(text, ans) {
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
        const indent = lines[pIdx].match(/^\s*/)[0];
        lines[pIdx] = cleanAns.split("\n").map(l => indent + l).join("\n");
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
  }

  // ─── Fill & Run Notebook Cells ───────────────────────────────────────────────
  async function fillNotebookAnswers(answers) {
    if (!answers || !answers.length) return;

    if (isColab()) {
      window.postMessage({ type: "UGLAB_NOTEBOOK_FILL", answers }, "*");
      // 1. Google Colab Native DOM & Cell Model update
      const nb = (typeof window !== "undefined" && window.colab?.global?.notebook) || (typeof colab !== "undefined" && colab?.global?.notebook);
      if (nb && Array.isArray(nb.cells)) {
        const exerciseCells = nb.cells.filter(c => {
          if (!c.model || c.model.type !== "code") return false;
          const t = c.model.getText() || "";
          return t.includes("# CODE HERE") || t.includes("<...>") || t.includes("# ...");
        });

        for (let i = 0; i < answers.length; i++) {
          const ans = answers[i];
          let codeAnswer = (typeof ans.jawaban === "string" ? ans.jawaban : "").trim();
          codeAnswer = codeAnswer.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
          if (!codeAnswer || codeAnswer === "TERPISAH") continue;

          const targetCell = (ans?.cellId && nb.cells.find(c => c.cellId === ans.cellId || c.id === ans.cellId)) || exerciseCells[i];
          if (targetCell?.model) {
            const currentText = targetCell.model.getText() || "";
            const updated = replaceCode(currentText, codeAnswer);
            targetCell.model.setText(updated);
            if (typeof targetCell.refresh === "function") targetCell.refresh();
          }
        }

        // Jalankan semua cell secara otomatis setelah seluruh kode terisi
        await sleep(500);
        if (typeof nb.runAll === "function") {
          nb.runAll();
        } else {
          document.querySelector('[command="runall"]')?.click();
        }
        return;
      }

      // 2. Fallback via Monaco Editor models (bekerja langsung di isolated content script)
      const models = typeof window.monaco !== "undefined" ? window.monaco.editor.getModels() : [];
      const targetModels = models
        .filter(m => !m.uri.toString().endsWith("/1") && !m.uri.toString().endsWith("/9"))
        .filter(m => {
          const v = m.getValue();
          return v.includes("# CODE HERE") || v.includes("<...>") || v.includes("# ...");
        })
        .sort((a, b) => parseInt(a.uri.toString().split("/").pop() || "0", 10) - parseInt(b.uri.toString().split("/").pop() || "0", 10));

      const editors = typeof window.monaco !== "undefined" ? window.monaco.editor.getEditors() : [];

      for (let i = 0; i < answers.length; i++) {
        const ans = answers[i];
        let codeAnswer = (typeof ans.jawaban === "string" ? ans.jawaban : "").trim();
        codeAnswer = codeAnswer.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
        if (!codeAnswer || codeAnswer === "TERPISAH") continue;

        const m = (ans?.cellId && targetModels.find(mod => mod.uri.toString().includes(ans.cellId))) || targetModels[i];
        if (m) {
          const val = m.getValue();
          const newVal = replaceCode(val, codeAnswer);
          m.setValue(newVal);
          const ed = editors.find(e => e.getModel() === m);
          if (ed) ed.render();
        }
      }

      // Trigger Run All via Colab Command Menu only if cells were modified
      if (targetModels.length > 0) {
        await sleep(500);
        document.querySelector('[command="runall"]')?.click();
      }
    }
  }

  // Fallback for scripting.executeScript Channel 2
  window.__prelabFill = function(answers) {
    fillNotebookAnswers(answers);
  };

  // Channel 3: Storage fallback listener
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.prelab_answers_pending?.newValue) {
        const data = changes.prelab_answers_pending.newValue;
        if (data?.answers) {
          fillNotebookAnswers(data.answers);
          chrome.storage.local.remove("prelab_answers_pending");
        }
      }
    });
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
