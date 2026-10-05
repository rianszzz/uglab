// lms-content.js — UGLab LMS Content Script
// Supports: iLab & v-class Gunadarma (Moodle-based) + ujian.gunadarma.ac.id (ASP.NET)

(function () {
  "use strict";

  // ─── Domain Detection ─────────────────────────────────────────────────────────
  const isUjianGunadarma = () => location.hostname.includes("ujian.gunadarma.ac.id");

  // ─── Utility ──────────────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ─── Question Extractors ────────────────────────────────────────────────────
  const EXTRACTORS = {
    // Moodle multichoice (radio)
    multichoice(container) {
      const qtext = extractQuestionText(container);
      const options = [];
      container.querySelectorAll(".answer .r0, .answer .r1, .answer input[type=radio]").forEach((el) => {
        const label = el.closest("label") || el.parentElement;
        const input = el.tagName === "INPUT" ? el : label?.querySelector("input[type=radio]");
        if (!input) return;
        // Use processMathContent to get a clean representation of mathematical labels
        const text = label ? processMathContent(label) : "";
        options.push({ value: input.value, text, input });
      });
      if (!options.length) {
        container.querySelectorAll("label").forEach(label => {
          const input = label.querySelector("input[type=radio]");
          if (input) options.push({ value: input.value, text: processMathContent(label), input });
        });
      }
      return { type: "multichoice", text: qtext, options };
    },

    // Moodle multi-select (checkbox)
    multianswer(container) {
      const qtext = extractQuestionText(container);
      const options = [];
      container.querySelectorAll("input[type=checkbox]").forEach((input) => {
        const label = input.closest("label") || container.querySelector(`label[for="${input.id}"]`);
        options.push({ value: input.value, text: label ? processMathContent(label) : "", input });
      });
      return { type: "multianswer", text: qtext, options };
    },

    // True/False
    truefalse(container) {
      const qtext = extractQuestionText(container);
      const options = [];
      container.querySelectorAll("input[type=radio]").forEach((input) => {
        const label = input.closest("label") || container.querySelector(`label[for="${input.id}"]`);
        options.push({ value: input.value, text: label?.innerText.trim() || input.value, input });
      });
      return { type: "truefalse", text: qtext, options };
    },

    // Short answer / text input
    shortanswer(container) {
      const inputSel = "input.coderunner-ui-element, input:not([type='hidden']):not([type='radio']):not([type='checkbox']):not([type='submit']):not([type='button']):not([class*='ace_hidden']), textarea.coderunner-answer, textarea.form-control, .answer input";
      const input = container.querySelector(inputSel);

      // If input is inside a code/pre block, include blank position in context
      const inCodeBlock = input && !!input.closest("pre, code, .code, .monospacewrap, .answer pre, table.answer");
      let qtext;
      if (inCodeBlock) {
        const clone = container.cloneNode(true);
        const cloneInput = clone.querySelector(inputSel);
        if (cloneInput) {
          cloneInput.replaceWith(document.createTextNode("[BLANK]"));
        }
        const formulation = clone.querySelector(".formulation, .content");
        qtext = ((formulation || clone).innerText || "").trim().slice(0, 5000);
      } else {
        qtext = extractQuestionText(container);
      }

      return { type: "shortanswer", text: qtext, input };
    },

    // Essay / textarea
    essay(container) {
      const qtext = extractQuestionText(container);
      const textarea = container.querySelector("textarea, .editor_atto_content, [contenteditable=true]");
      return { type: "essay", text: qtext, textarea };
    },

    // Coding / programming
    coding(container) {
      let qtext = extractQuestionText(container);
      let template = "";

      // Scrape the pristine code template so the AI knows what to fill
      const virtualDomEditor = container.querySelector("[data-raw-code]");
      if (virtualDomEditor && virtualDomEditor.hasAttribute("data-raw-code")) {
        template = virtualDomEditor.getAttribute("data-raw-code");
      } else {
        const ta = container.querySelector("textarea[name*='answer'], textarea.coderunner-answer, textarea.code");
        if (ta && ta.value) {
          template = ta.value;
        } else {
          // Fallback: extract from Ace editor line rendering
          const aceLines = Array.from(container.querySelectorAll(".ace_line"));
          if (aceLines.length > 0) {
            template = aceLines.map(line => line.innerText).join("\\n");
          }
        }
      }

      if (template && template.trim().length > 0) {
        qtext += "\\n\\n[TEMPLATE KODE AWAL DARI DOSEN (LENGKAPI TEMPLATE INI!)]:\\n" + template;
      }

      const textarea = container.querySelector("textarea.code, .CodeMirror, .ace_editor, textarea");
      return { type: "coding", text: qtext, textarea };
    },

    // Multi-box (fill multiple blanks)
    multifill(container) {
      const clone = container.cloneNode(true);
      // Remove feedback/outcome blocks if they exist (to avoid confusion)
      clone.querySelectorAll(".answer, .ablock, .outcome, .comment").forEach(el => el.remove());
      
      const clozeQuery = "input:not([type='hidden']):not([type='radio']):not([type='checkbox']):not([type='submit']):not([type='button']):not([class*='ace_hidden']), select, textarea.coderunner-answer, textarea.form-control";
      
      const realInputs = Array.from(container.querySelectorAll(clozeQuery));
      
      const cloneInputs = Array.from(clone.querySelectorAll(clozeQuery));
      cloneInputs.forEach((inp, idx) => {
        const placeholder = document.createTextNode(` [KOTAK KOSONG ${idx}] `);
        if (inp.parentNode) inp.parentNode.replaceChild(placeholder, inp);
      });
      
      // Capture the entire formulation area (including code blocks/pre/images context)
      const formulation = clone.querySelector(".formulation, .content");
      const qtext = formulation ? formulation.innerText.trim() : clone.innerText.trim();
      
      // NEW: Extract options for dropdowns if they exist
      const dropdownOptions = [];
      realInputs.forEach((input, i) => {
        if (input.tagName === "SELECT") {
          const options = Array.from(input.options)
            .filter(o => o.value && o.text.trim().toLowerCase() !== "choose...")
            .map(o => o.text.trim());
          if (options.length > 0) {
            dropdownOptions.push({ index: i, options });
          }
        }
      });

      return { 
        type: "multifill", 
        text: qtext.slice(0, 5000), 
        inputs: realInputs,
        dropdownOptions: dropdownOptions.length > 0 ? dropdownOptions : null
      };
    },

    // Moodle Matching (Menjodohkan)
    match(container) {
      const qtext = extractQuestionText(container);
      const subquestions = [];
      const allOptions = new Set();
      const rowImages = [];
      
      // Find all rows that contain a sub-question label and a select
      // Moodle typically uses a table or div rows for matching
      container.querySelectorAll("tr, .r0, .r1, .p-v-md, .form-group").forEach((row) => {
        let label = row.querySelector(".text, td:first-child, label, .qtext");
        const select = row.querySelector("select");
        if (label && select) {
          let subText = label.innerText.trim();
          
          // NEW: Identify images inside the specific row/item
          const imgsInRow = Array.from(row.querySelectorAll("img")).filter(
            img => !img.src.includes("icon") && !img.src.includes("spacer")
          );
          
          if (imgsInRow.length > 0) {
            imgsInRow.forEach(img => {
              rowImages.push(img);
              const idx = rowImages.length;
              subText = `[GAMBAR ${idx}] ${subText}`.trim();
            });
          }

          // If there's no text (only image), default it to something so it's not skipped.
          if (!subText) subText = `Bagian ${subquestions.length + 1}`;
          if (subText.toLowerCase() === "choose...") subText = `Bagian ${subquestions.length + 1}`;

          if (subText.length > 0) {
            subquestions.push({ text: subText, select });
            
            // Collect available options (usually same for all)
            Array.from(select.options).forEach(opt => {
              if (opt.value && opt.text.trim().toLowerCase() !== "choose...") {
                allOptions.add(opt.text.trim());
              }
            });
          }
        }
      });

      // Format a clean text for the AI
      let formattedText = qtext + "\n\nPasangkanlah item berikut:\n";
      subquestions.forEach((sq, i) => {
        formattedText += `${i + 1}. ${sq.text} -> [KOTAK ${i}]\n`;
      });

      return {
        type: "match",
        text: formattedText,
        options: Array.from(allOptions).map(text => ({ text })),
        inputs: subquestions.map(sq => sq.select),
        rowImages: rowImages.length > 0 ? rowImages : null
      };
    },

    // CodeRunner gapfiller — input(s) embedded inside <pre> code block
    gapfiller(container) {
      const gapSel = "input.coderunner-ui-element, input[name*='gapfiller']";
      const inputs = Array.from(container.querySelectorAll(gapSel));

      // Build question text with [BLANK_N] markers showing exact gap positions
      const clone = container.cloneNode(true);
      clone.querySelectorAll(gapSel).forEach((inp, i) => {
        inp.replaceWith(document.createTextNode(`[BLANK_${i}]`));
      });
      const formulation = clone.querySelector(".formulation, .content");
      const qtext = ((formulation || clone).innerText || "").trim().slice(0, 5000);

      return { type: "gapfiller", text: qtext, inputs };
    },
  };

  function extractQuestionText(container) {
    // Priority: Formulation area contains the whole context (text, code, instructions)
    const formulation = container.querySelector(".formulation, .content");
    if (formulation) {
      return processMathContent(formulation).slice(0, 5000);
    }
    const qtext = container.querySelector(".qtext, .question-text, .que .content p, h4.qtext");
    if (qtext) return processMathContent(qtext).slice(0, 5000);

    // Fallback: get all visible text except option labels and feedback
    const clone = container.cloneNode(true);
    clone.querySelectorAll(".answer, .ablock, .outcome, .comment").forEach(el => el.remove());
    return processMathContent(clone).slice(0, 3000);
  }

  function processMathContent(element) {
    if (!element) return "";

    const clone = element.cloneNode(true);

    const mathWrapText = (tex, isDisplay) =>
      isDisplay ? `\n$$ ${tex.trim()} $$\n` : ` $${tex.trim()}$ `;

    const replaceMathNode = (node, text) => {
      const wrapper = document.createElement("span");
      wrapper.textContent = text;
      const parent = node.parentElement;
      if (parent && parent.classList.contains("filter_mathjaxloader_equation")) {
        parent.replaceWith(wrapper);
      } else {
        node.replaceWith(wrapper);
      }
    };

    // 1. MathJax 3 WITH data-math: extract original TeX directly
    clone.querySelectorAll("mjx-container[data-math]").forEach(mjx => {
      const tex = mjx.getAttribute("data-math");
      if (!tex || !tex.trim()) return;
      const isDisplay = mjx.getAttribute("display") === "true";
      replaceMathNode(mjx, mathWrapText(tex, isDisplay));
    });

    // 2. MathJax 3 WITHOUT data-math: extract from assistive MML or aria-label
    // Must run AFTER step 1 so only unhandled mjx-containers remain
    clone.querySelectorAll("mjx-container").forEach(mjx => {
      const assistiveMath = mjx.querySelector("mjx-assistive-mml math, math");
      let text = "";
      if (assistiveMath) {
        const label = assistiveMath.getAttribute("aria-label") || mjx.getAttribute("aria-label") || "";
        if (label && label.length < 400) {
          text = ` [MATH: ${label}] `;
        } else {
          text = ` [MATHML: ${new XMLSerializer().serializeToString(assistiveMath)}] `;
        }
      } else {
        const label = mjx.getAttribute("aria-label") || "";
        text = label ? ` [MATH: ${label}] ` : "";
      }
      replaceMathNode(mjx, text);
    });

    // 3. MathJax 2: <script type="math/tex"> contains original TeX source
    clone.querySelectorAll('script[type^="math/tex"]').forEach(script => {
      const isDisplay = script.type.includes("display");
      const tex = script.textContent.trim();
      const prev = script.previousElementSibling;
      if (prev && typeof prev.className === "string" && prev.className.includes("MathJax")) {
        prev.remove();
      }
      replaceMathNode(script, mathWrapText(tex, isDisplay));
    });

    // 4. Remove remaining MathJax visual noise
    clone.querySelectorAll(".MathJax_Preview, .MathJax, .mjx-chtml").forEach(el => el.remove());

    // 5. Any raw <math> element still remaining (mjx-container fully replaced above)
    clone.querySelectorAll("math").forEach(mathEl => {
      const label = mathEl.getAttribute("aria-label") || "";
      const wrapper = document.createElement("span");
      if (label && label.length > 0 && label.length < 400) {
        wrapper.textContent = ` [MATH: ${label}] `;
      } else {
        wrapper.textContent = ` [MATHML: ${new XMLSerializer().serializeToString(mathEl)}] `;
      }
      mathEl.replaceWith(wrapper);
    });

    // 6. KaTeX
    clone.querySelectorAll(".katex").forEach(el => {
      const label = el.getAttribute("aria-label") || el.querySelector("[aria-label]")?.getAttribute("aria-label");
      el.textContent = label ? ` $${label}$ ` : "";
    });

    let text = clone.innerText || "";
    text = text.replace(/[ \t]+/g, " ").trim();

    return text;
  }

  function detectQuestionType(container) {
    const classes = container.className || "";
    if (classes.includes("truefalse")) return "truefalse";
    if (classes.includes("essay")) return "essay";

    // CodeRunner gapfiller MUST be checked BEFORE generic coderunner class check,
    // because gapfiller has input-in-pre structure, not Ace/CodeMirror
    if (container.querySelector("pre input.coderunner-ui-element, pre input[name*='gapfiller']")) return "gapfiller";

    // "coderunner" harus dicek SEBELUM heuristic input, karena textarea.coderunner-answer
    // akan salah dideteksi sebagai "shortanswer" jika dibiarkan ke clozeQuery
    if (classes.includes("coding") || classes.includes("programmingtask") || classes.includes("coderunner")) return "coding";
    if (classes.includes("matching") || classes.includes("match")) return "match";

    // Heuristics — cek Ace/CodeMirror editor SEBELUM generic input scan
    if (container.querySelector(".ace_editor, .CodeMirror")) return "coding";
    if (container.querySelector(".qtype_match") || container.querySelector(".matching")) return "match";
    if (container.querySelector("input[type=radio]")) {
      const inputs = container.querySelectorAll("input[type=radio]");
      if (inputs.length === 2 && classes.includes("truefalse")) return "truefalse";
      return "multichoice";
    }
    if (container.querySelector("input[type=checkbox]")) return "multianswer";

    // Select all generic inputs (text, number, no-type specified)
    // Exclude textarea.coderunner-answer dari sini — sudah ditangani di atas
    const clozeQuery = "input:not([type='hidden']):not([type='radio']):not([type='checkbox']):not([type='submit']):not([type='button']):not([class*='ace_hidden']), select, textarea.form-control";
    const textInputs = container.querySelectorAll(clozeQuery);
    if (textInputs.length > 1) return "multifill";
    if (textInputs.length === 1) return "shortanswer";
    
    if (container.querySelector("textarea, [contenteditable=true]")) return "essay";
    
    // Fallbacks
    if (classes.includes("multichoice")) return "multichoice";
    if (classes.includes("shortanswer")) return "shortanswer";
    if (classes.includes("multianswer")) return "multifill"; // Moodle cloze with inputs
    
    return "shortanswer";
  }

  // ─── Extract Images ──────────────────────────────────────────────────────────
  async function extractImages(container, specificImgs = null) {
    const imgs = specificImgs || Array.from(container.querySelectorAll("img")).filter(
      img => !img.src.includes("icon") && !img.src.includes("spacer")
    );
    const results = [];
    
    // Menggunakan Fetch API untuk mengambil gambar secara langsung agar lebih reliabel dibanding Canvas (mencegah Tainted Canvas)
    for (const img of imgs.slice(0, 4)) {
      try {
        if (img.src && img.src.startsWith("data:image")) {
          results.push(img.src.split(",")[1]);
        } else if (img.src) {
          // 'include' sangat penting agar Cookie sesi login Gunadarma (pluginfile.php) ikut terkirim
          const response = await fetch(img.src, { credentials: 'include' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          
          const blob = await response.blob();
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          results.push(base64);
        }
      } catch (e) {
        console.warn("[UGLab] Gagal meng-fetch gambar dari DOM:", img.src, e);
      }
    }
    return results;
  }

  // ─── Scrape All Questions ────────────────────────────────────────────────────
  async function scrapeQuestions() {
    // Flush Ace/CodeMirror Virtual DOM values into a physical DOM attribute 
    // This allows the isolated extension to extract massive code templates accurately even if scroll-hidden
    const flushScript = document.createElement("script");
    flushScript.textContent = `
      (function() {
        try {
          document.querySelectorAll(".ace_editor").forEach(el => {
             const val = (el.env && el.env.editor)
               ? el.env.editor.getValue()
               : (window.ace ? window.ace.edit(el).getValue() : null);
             if (val !== null) {
               el.setAttribute("data-raw-code", val);
               // data-prelab-original: simpan template asli hanya sekali per page load.
               // Tidak ditimpa pada scan ulang — dipakai fillCoding sebagai base yang bersih.
               if (!el.hasAttribute("data-prelab-original")) {
                 el.setAttribute("data-prelab-original", val);
               }
             }
          });
          document.querySelectorAll(".CodeMirror").forEach(el => {
             const val = el.CodeMirror
               ? el.CodeMirror.getValue()
               : (el._cmView && el._cmView.state && el._cmView.state.doc ? el._cmView.state.doc.toString() : null);
             if (val !== null) {
               el.setAttribute("data-raw-code", val);
               if (!el.hasAttribute("data-prelab-original")) {
                 el.setAttribute("data-prelab-original", val);
               }
             }
          });
        } catch(e){}
      })();
    `;
    document.documentElement.appendChild(flushScript);
    flushScript.remove(); // Execute synchronously and clean up

    const questions = [];
    const selectors = [
      "div.que", 
      "div[id^='question-'][class*='que']",
      ".quizquestion",
      "form .qn_container", 
      ".qblock", 
      ".quiz_slot"
    ];

    let containers = [];
    for (const sel of selectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) { containers = Array.from(found); break; }
    }

    // iLab specific
    if (!containers.length) {
      containers = Array.from(document.querySelectorAll("form .qn_container, .qblock, .quiz_slot"));
    }

    for (let i = 0; i < containers.length; i++) {
      const container = containers[i];
      const type = detectQuestionType(container);
      const extractor = EXTRACTORS[type] || EXTRACTORS.shortanswer;
      const data = extractor(container);
      
      // Only extract images for types that can have meaningful images.
      // Include coding/essay as they often contain diagrams or requirement images.
      const typeNeedsImages = ["multichoice", "truefalse", "multianswer", "match", "coding", "essay", "shortanswer", "multifill", "gapfiller"].includes(type);
      let images = [];
      if (typeNeedsImages) {
        let imgsToExtract = data.rowImages ? [...data.rowImages] : [];
        const generalImgs = Array.from(container.querySelectorAll("img")).filter(
          img => !img.src.includes("icon") && !img.src.includes("spacer") && !imgsToExtract.includes(img)
        );
        imgsToExtract = [...imgsToExtract, ...generalImgs];
        images = await extractImages(container, imgsToExtract);
      }

      const q = {
        index: i,
        type: data.type,
        text: data.text,
        images,
        containerIndex: i,
      };

      if (data.options) {
        q.options = data.options.map(o => ({ value: o.value, text: o.text }));
      }
      
      // Pass through specialized data
      if (data.dropdownOptions) {
        q.dropdownOptions = data.dropdownOptions;
      }

      questions.push(q);
    }
    return questions;
  }

  // ─── Answer Filler ───────────────────────────────────────────────────────────
  function fillAnswer(questionIndex, answer) {
    const selectors = [".que", ".question", ".quizquestion", "[class*='question']"];
    let containers = [];
    for (const sel of selectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) { containers = Array.from(found); break; }
    }
    if (!containers.length) return false;
    const container = containers[questionIndex];
    if (!container) return false;

    const type = detectQuestionType(container);
    // Normalize Gemini answer type (may return 'Essay' with capital)
    const ansType = (answer.type || "").toLowerCase();

    try {
      let ok = false;
      switch (type) {
        case "multichoice":
        case "truefalse":
          ok = fillRadio(container, answer);
          break;
        case "multianswer":
          ok = fillCheckbox(container, answer);
          break;
        case "shortanswer":
          ok = fillText(container, answer.jawaban ?? answer);
          break;
        case "essay":
          ok = fillEssay(container, answer.jawaban ?? answer);
          break;
        case "coding":
          ok = fillCoding(container, answer.jawaban ?? answer);
          break;
        case "gapfiller":
          ok = fillGapFiller(container, answer.jawaban ?? answer);
          break;
        case "match":
          ok = fillMatch(container, answer.jawaban ?? answer);
          break;
        case "multifill":
          ok = fillMulti(container, answer.jawaban ?? answer);
          break;
        default:
          // Try all strategies
          ok = fillText(container, answer.jawaban ?? answer) ||
               fillEssay(container, answer.jawaban ?? answer);
      }

      // If DOM type didn't work and Gemini said it's essay/coding, try that too
      if (!ok && (ansType === "essay" || ansType === "coding")) {
        ok = fillEssay(container, answer.jawaban ?? answer);
      }
      if (!ok) {
        // Last resort: try every filler
        ok = fillText(container, answer.jawaban ?? answer) ||
             fillEssay(container, answer.jawaban ?? answer) ||
             fillRadio(container, answer);
      }
      return ok;
    } catch (e) {
      console.error("[UGLab] Fill error:", e);
      return false;
    }
  }

  function fillRadio(container, answer) {
    const indexPilihan = typeof answer.index_pilihan === "number" ? answer.index_pilihan : null;
    // Normalize: convert literal '\n' and '\t' to spaces, then collapse physical whitespaces
    const normalize = (s) => String(s || "")
      .replace(/\\n/g, " ")
      .replace(/\\t/g, " ")
      .replace(/\s+/g, " ")
      .toLowerCase()
      .trim();
    const jawabanNorm = normalize(answer.jawaban);

    const radios = Array.from(container.querySelectorAll("input[type=radio]"));
    if (!radios.length) return false;

    let target = null;
    let targetLabel = null;

    // Build a map of all options
    const options = radios.map((r, idx) => {
      const label = r.closest("label") ||
        container.querySelector(`label[for="${r.id}"]`) ||
        r.parentElement;
      return { r, idx, label, textNorm: normalize(processMathContent(label)) };
    });

    // Strategy 1: Exact text match (SAFEST)
    if (jawabanNorm) {
      const exactMatch = options.find(o => o.textNorm === jawabanNorm);
      if (exactMatch) {
        target = exactMatch.r;
        targetLabel = exactMatch.label;
        console.log(`[UGLab] fillRadio: exact match text="${jawabanNorm}"`);
      }
    }

    // Strategy 2: Substring text match
    if (!target && jawabanNorm) {
      const subMatch = options.find(o => 
        o.textNorm.includes(jawabanNorm) || 
        (jawabanNorm.includes(o.textNorm) && o.textNorm.length > 5)
      );
      if (subMatch) {
        target = subMatch.r;
        targetLabel = subMatch.label;
        console.log(`[UGLab] fillRadio: substring match text="${jawabanNorm}" inside "${subMatch.textNorm}"`);
      }
    }

    // Strategy 3: Math-Aware Fuzzy Match
    if (!target && jawabanNorm) {
      // Normalize both: remove all whitespace and standardize operators
      const mathNormalize = (s) => normalize(s)
        .replace(/\s+/g, "")
        .replace(/\^/g, "**")
        .replace(/\\/g, "")
        .replace(/\{|\}/g, "")
        .replace(/frac/g, "") // Common in LaTeX
        .replace(/\(|\)/g, ""); // Remove parenthesis for extreme fuzzy match

      const jawabanMath = mathNormalize(answer.jawaban);
      const subMatch = options.find(o => {
        const optionMath = mathNormalize(o.textNorm);
        return optionMath.includes(jawabanMath) || jawabanMath.includes(optionMath);
      });
      
      if (subMatch) {
        target = subMatch.r;
        targetLabel = subMatch.label;
        console.log(`[UGLab] fillRadio: fuzzy math match text="${jawabanMath}"`);
      }
    }

    // Strategy 4: Trust index_pilihan from Gemini as fallback
    if (!target && indexPilihan !== null && options[indexPilihan]) {
      target = options[indexPilihan].r;
      targetLabel = options[indexPilihan].label;
      console.log(`[UGLab] fillRadio: fallback to index_pilihan=${indexPilihan}`);
    }

    if (!target) {
      console.warn(`[UGLab] fillRadio: no match for jawaban="${jawabanNorm}" index=${indexPilihan}`);
      return false;
    }

    // Robust Click (Power Click): Trigger sequence of events to satisfy Moodle's reactive state
    const triggerClick = (el) => {
      if (!el) return;
      const options = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new MouseEvent("mousedown", options));
      el.click();
      el.dispatchEvent(new MouseEvent("mouseup", options));
    };

    if (targetLabel) {
      triggerClick(targetLabel);
    } else {
      triggerClick(target);
    }
    
    target.checked = true;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    highlightFilled(targetLabel || target.parentElement || target);
    return true;
  }

  function fillCheckbox(container, answer) {
    const indices = Array.isArray(answer.index_pilihan) ? answer.index_pilihan : [answer.index_pilihan];
    const checkboxes = Array.from(container.querySelectorAll("input[type=checkbox]"));

    // Uncheck all first safely without inverting
    checkboxes.forEach(cb => { 
      if (cb.checked) {
        cb.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        cb.click();
        cb.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      }
      cb.checked = false; 
      cb.dispatchEvent(new Event("change", { bubbles: true })); 
    });

    // Check the requested indices
    indices.forEach(idx => {
      if (typeof idx === "number" && checkboxes[idx]) {
        const cb = checkboxes[idx];
        if (!cb.checked) {
          cb.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          cb.click(); 
          cb.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        }
        cb.checked = true; // Hard enforce
        cb.dispatchEvent(new Event("input", { bubbles: true }));
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        highlightFilled(cb.parentElement || cb);
      }
    });
    return true;
  }

  function fillText(container, text) {
    // Select any input that isn't a button, radio, checkbox, or hidden
    const input = container.querySelector(
      "input.coderunner-ui-element, input:not([type='hidden']):not([type='radio']):not([type='checkbox']):not([type='submit']):not([type='button']):not([class*='ace_hidden']), textarea.coderunner-answer, textarea.form-control, .answer input"
    );
    if (!input) return false;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, String(text));
    } else {
      input.value = String(text);
    }
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    highlightFilled(input);
    return true;
  }

  function fillGapFiller(container, answer) {
    const gapSel = "input.coderunner-ui-element, input[name*='gapfiller']";
    const inputs = Array.from(container.querySelectorAll(gapSel));
    if (!inputs.length) return false;

    // answers may be array (multiple gaps) or single string
    const vals = Array.isArray(answer)
      ? answer
      : [String(answer ?? "")];

    // Set each visible gap input
    inputs.forEach((input, i) => {
      const val = vals[i] !== undefined ? String(vals[i]) : "";
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (nativeSetter) nativeSetter.call(input, val);
      else input.value = val;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      highlightFilled(input);
    });

    // Assemble full code from <pre> and write to hidden textarea directly.
    // CodeRunner ignores synthetic events (isTrusted=false), so we must bypass its sync.
    const pre = inputs[0].closest("pre");
    const ta = container.querySelector("textarea.coderunner-answer");
    if (pre && ta) {
      const preClone = pre.cloneNode(true);
      Array.from(preClone.querySelectorAll(gapSel)).forEach((inp, i) => {
        inp.replaceWith(document.createTextNode(vals[i] !== undefined ? vals[i] : ""));
      });
      const assembled = preClone.textContent;
      const taSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (taSetter) taSetter.call(ta, assembled);
      else ta.value = assembled;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
    }

    return true;
  }

  function fillEssay(container, text) {
    const textStr = String(text ?? "");
    let filled = false;

    // 1. Any iframe-based Rich Text Editors (Atto / TinyMCE)
    const iframes = container.querySelectorAll("iframe.editor_atto, iframe[id*='editor'], iframe[id*='ifr'], iframe.tox-edit-area__iframe");
    iframes.forEach(ifr => {
      try {
        const doc = ifr.contentDocument || ifr.contentWindow?.document;
        if (doc && doc.body) {
          doc.body.innerHTML = `<p>${textStr.replace(/\n/g, "</p><p>")}</p>`;
          doc.body.dispatchEvent(new InputEvent("input", { bubbles: true }));
          highlightFilled(ifr);
          filled = true;
        }
      } catch (e) {
        console.warn("[UGLab] Editor iframe access failed:", e.message);
      }
    });

    // 2. Any ContentEditable elements (Inline Atto / TinyMCE / Quill)
    const editables = container.querySelectorAll("[contenteditable=true], .editor_atto_content, .ql-editor");
    editables.forEach(editable => {
      editable.focus();
      // Most rich text editors prefer HTML content
      editable.innerHTML = `<p>${textStr.replace(/\n/g, "</p><p>")}</p>`;
      editable.dispatchEvent(new InputEvent("input", { bubbles: true }));
      editable.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      editable.dispatchEvent(new Event("change", { bubbles: true }));
      editable.dispatchEvent(new Event("blur", { bubbles: true }));
      highlightFilled(editable);
      filled = true;
    });

    // 3. Any Textareas (CRITICAL: The underlying form field Moodle actually submits)
    const textareas = container.querySelectorAll("textarea");
    textareas.forEach(ta => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(ta, textStr); else ta.value = textStr;
      ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
      
      // If none of the rich-text UIs were found, highlight the textarea
      if (!filled || ta.offsetWidth > 0) {
        highlightFilled(ta.parentElement || ta);
      }
      filled = true;
    });

    if (filled) return true;

    // 4. Fallback: text input (fill-in-blank inside code)
    return fillText(container, textStr);
  }



  // ─── Coding Answer Helpers (pure content-script-world functions) ─────────────

  // Jika AI menulis full class, ekstrak HANYA method body yang diminta.
  function extractMethod(code) {
    const mainIdx = code.indexOf("public static void main");
    if (mainIdx === -1) return code.trim();
    const classOpenIdx = code.indexOf("{");
    if (classOpenIdx === -1 || classOpenIdx >= mainIdx) return code.trim();
    const between = code.slice(classOpenIdx + 1, mainIdx);
    const jaIdx = between.indexOf("JANGAN UBAH");
    const guardIdx = between.lastIndexOf("/*", jaIdx !== -1 ? jaIdx : between.length);
    const cutAt = guardIdx !== -1 ? guardIdx : between.length;
    const cleaned = between.slice(0, cutAt).trim()
      .split("\n")
      .filter(l => { const t = l.trim(); return !(t.startsWith("//") && /tuliskan/i.test(t)); })
      .join("\n").trim();
    return cleaned.length > 5 ? cleaned : code.trim();
  }

  // Sisipkan method ke posisi placeholder di dalam template.
  // Kembalikan null jika template tidak memiliki marker Tuliskan/guard (caller pakai raw code).
  function buildFinalCode(template, codeStr) {
    if (!template || !template.includes("public static void main")) return null;

    const methodCode = extractMethod(codeStr);
    const lines = template.split("\n");
    let tulisLine = -1, guardLine = -1;

    for (let i = 0; i < lines.length; i++) {
      if (tulisLine === -1 && /tuliskan/i.test(lines[i])) {
        tulisLine = i;
      } else if (tulisLine !== -1 && guardLine === -1) {
        if (lines[i].indexOf("JANGAN UBAH") !== -1) { guardLine = i; break; }
        const t = lines[i].trim();
        if (t.length > 8 && t[0] === "/" && t[1] === "*" && t[2] === "*") { guardLine = i; break; }
      }
    }

    if (tulisLine === -1 || guardLine === -1) return null;

    // Deteksi indentasi dari baris // Tuliskan
    const indentMatch = lines[tulisLine].match(/^(\s+)/);
    const indent = indentMatch ? indentMatch[1] : "    ";
    const indented = methodCode.split("\n").map(l => l.length ? indent + l : l).join("\n");

    // Ganti baris placeholder (tulisLine+1 s.d. sebelum guardLine) dengan method
    return [
      ...lines.slice(0, tulisLine + 1),
      indented,
      "",
      ...lines.slice(guardLine)
    ].join("\n");
  }

  // ─────────────────────────────────────────────────────────────────────────────

  function fillCoding(container, code) {
    let codeStr = String(code ?? "");

    // Strip markdown code fences jika AI menambahkannya di dalam JSON string
    codeStr = codeStr.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```$/, "").trim();

    if (!container.id) {
      container.id = "prelab-code-container-" + Math.random().toString(36).substr(2, 9);
    }

    const eventName = "prelab-coding-filled-" + container.id;
    let mainWorldSuccess = false;
    const listener = () => { mainWorldSuccess = true; };
    document.addEventListener(eventName, listener, { once: true });

    // Bangun finalCode di content script world (DOM attr bisa dibaca langsung di sini).
    const editorEl = container.querySelector(".ace_editor") || container.querySelector(".CodeMirror");

    // Baca originalTemplate dengan beberapa fallback:
    // 1. data-prelab-original (di-set oleh flush script jika Ace API berhasil)
    // 2. textarea.coderunner-answer (Ace sync ke textarea setelah init — tersedia tanpa Ace API)
    // 3. .ace_line rendered DOM (last resort, no Ace API)
    let originalTemplate = editorEl ? (editorEl.getAttribute("data-prelab-original") || null) : null;

    if (!originalTemplate) {
      const ta = container.querySelector("textarea.coderunner-answer");
      if (ta && ta.value && ta.value.includes("public class")) {
        originalTemplate = ta.value;
        if (editorEl) editorEl.setAttribute("data-prelab-original", ta.value);
      }
    }

    if (!originalTemplate) {
      const aceEl = container.querySelector(".ace_editor");
      if (aceEl) {
        const lines = Array.from(aceEl.querySelectorAll(".ace_line"));
        if (lines.length > 0) {
          const fromLines = lines.map(l => l.innerText).join("\n");
          if (fromLines.includes("public class") || fromLines.includes("public static void main")) {
            originalTemplate = fromLines;
            aceEl.setAttribute("data-prelab-original", fromLines);
          }
        }
      }
    }

    const finalCode = buildFinalCode(originalTemplate, codeStr) ?? codeStr;

    // Injected script: HANYA set value.
    // Ace diakses via: el.env.editor → window.ace → RequireJS registry (Moodle AMD).
    const script = document.createElement("script");
    script.textContent = `
      (function() {
        try {
          const container = document.getElementById("${container.id}");
          if (!container) return;
          const finalCode = ${JSON.stringify(finalCode)};

          // Cari Ace editor via beberapa metode (termasuk RequireJS AMD untuk Moodle)
          function getAceEditor(aceEl) {
            if (aceEl.env && aceEl.env.editor) return aceEl.env.editor;
            if (window.ace && window.ace.edit) {
              try { return window.ace.edit(aceEl); } catch(e) {}
            }
            // RequireJS internal registry — Moodle load Ace via AMD, tidak expose window.ace
            try {
              var def = window.require && window.require.s
                        && window.require.s.contexts && window.require.s.contexts._
                        && window.require.s.contexts._.defined;
              if (def) {
                var aceModule = def["qtype_coderunner/ace/ace"] || def["ace/ace"] || def["ace"];
                if (aceModule && aceModule.edit) return aceModule.edit(aceEl);
              }
            } catch(e) {}
            return null;
          }

          // 1. Ace Editor
          const aceEl = container.querySelector(".ace_editor");
          if (aceEl) {
            const editor = getAceEditor(aceEl);
            if (editor) {
              editor.setValue(finalCode, 1);
              document.dispatchEvent(new CustomEvent("${eventName}"));
              return;
            }
          }

          // 2. CodeMirror v5
          const cmEl = container.querySelector(".CodeMirror");
          if (cmEl && cmEl.CodeMirror) {
            cmEl.CodeMirror.setValue(finalCode);
            document.dispatchEvent(new CustomEvent("${eventName}"));
            return;
          }

          // 3. CodeMirror v6
          if (cmEl && cmEl._cmView && cmEl._cmView.dispatch) {
            cmEl._cmView.dispatch({ changes: { from: 0, to: cmEl._cmView.state.doc.length, insert: finalCode } });
            document.dispatchEvent(new CustomEvent("${eventName}"));
            return;
          }
        } catch (e) {
          console.error("Prelab fillCoding error:", e);
        }
      })();
    `;

    document.documentElement.appendChild(script);
    script.remove();

    if (mainWorldSuccess) {
      highlightFilled(container.querySelector(".CodeMirror") || container.querySelector(".ace_editor") || container);
      return true;
    }

    // Fallback: set textarea langsung TANPA dispatch input/change
    // (menghindari CodeRunner's insert behavior yang menyebabkan doubling)
    const taFallback = container.querySelector("textarea.coderunner-answer");
    if (taFallback) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(taFallback, finalCode); else taFallback.value = finalCode;
      highlightFilled(taFallback.parentElement || taFallback);
      return true;
    }

    return fillEssay(container, codeStr);
  }

  function fillMulti(container, answers) {
    const clozeQuery = "input:not([type='hidden']):not([type='radio']):not([type='checkbox']):not([type='submit']):not([type='button']):not([class*='ace_hidden']), select, textarea.coderunner-answer, textarea.form-control";
    const inputs = Array.from(container.querySelectorAll(clozeQuery));
    const vals = Array.isArray(answers) ? answers : String(answers).split(/[,;|\n]/).map(s => s.trim());

    inputs.forEach((input, i) => {
      let val = vals[i] !== undefined ? String(vals[i]) : "";
      input.focus();
      if (input.tagName === "SELECT") {
        // Handle select dropdown match if needed
        const opt = Array.from(input.options).find(o => o.text.trim().toLowerCase() === val.toLowerCase() || o.value === val);
        if (opt) input.value = opt.value;
      } else {
        input.value = val;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      highlightFilled(input);
    });
    return true;
  }

  // Specialized filler for Matching questions. Matches exactly the DOM extraction path.
  function fillMatch(container, answers) {
    const vals = Array.isArray(answers) ? answers : String(answers).split(/[,;|\n]/).map(s => s.trim());
    const selects = [];
    
    // Traverse the DOM precisely identical to EXTRACTORS.match to find the exact targets
    container.querySelectorAll("tr, .r0, .r1, .p-v-md, .form-group").forEach((row) => {
      let label = row.querySelector(".text, td:first-child, label, .qtext");
      const select = row.querySelector("select");
      if (label && select) {
        selects.push(select);
      }
    });

    if (selects.length === 0) return fillMulti(container, answers); // Fallback

    selects.forEach((select, i) => {
      let val = vals[i] !== undefined ? String(vals[i]) : "";
      if (!val) return; // leave it alone if AI returned fewer options
      
      select.focus();
      const lowerVal = val.toLowerCase();
      const opt = Array.from(select.options).find(o => o.text.trim().toLowerCase() === lowerVal || o.value === val);
      if (opt) select.value = opt.value;
      
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      highlightFilled(select);
    });
    return true;
  }


  function highlightFilled(el) {
    if (!el) return;
    el.style.transition = "box-shadow 0.3s ease";
    el.style.boxShadow = "0 0 0 3px #00ff9580, 0 0 12px #00ff9540";
    setTimeout(() => { el.style.boxShadow = ""; }, 2000);
  }

  // ─── Floating Status UI ───────────────────────────────────────────────────────
  function createStatusBadge() {
    const existing = document.getElementById("prelab-status");
    if (existing) return existing;

    const badge = document.createElement("div");
    badge.id = "prelab-status";
    badge.innerHTML = `
      <div class="prelab-badge-inner">
        <span class="prelab-icon">⚡</span>
        <span class="prelab-text">UGLab Ready</span>
      </div>
    `;
    badge.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 999999;
      background: rgba(10, 10, 20, 0.85); backdrop-filter: blur(16px);
      border: 1px solid rgba(0, 255, 149, 0.3); border-radius: 12px;
      padding: 8px 14px; color: #00ff95; font-family: 'Segoe UI', sans-serif;
      font-size: 13px; font-weight: 600; cursor: default;
      box-shadow: 0 4px 24px rgba(0, 255, 149, 0.15);
      display: flex; align-items: center; gap: 8px;
      transition: all 0.3s ease;
    `;

    const style = document.createElement("style");
    style.textContent = `
      #prelab-status .prelab-badge-inner { display: flex; align-items: center; gap: 8px; }
      #prelab-status.loading { border-color: rgba(255, 200, 0, 0.5); color: #ffc800; box-shadow: 0 4px 24px rgba(255,200,0,0.2); }
      #prelab-status.success { border-color: rgba(0, 255, 149, 0.6); color: #00ff95; box-shadow: 0 4px 24px rgba(0,255,149,0.3); }
      #prelab-status.error { border-color: rgba(255, 80, 80, 0.5); color: #ff5050; box-shadow: 0 4px 24px rgba(255,80,80,0.2); }
      #prelab-status .prelab-icon { animation: none; }
      #prelab-status.loading .prelab-icon { animation: spin 1s linear infinite; display: inline-block; }
      @keyframes spin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
    document.body.appendChild(badge);
    return badge;
  }

  function updateStatus(status, text) {
    const badge = document.getElementById("prelab-status") || createStatusBadge();
    badge.className = status;
    badge.querySelector(".prelab-icon").textContent = status === "loading" ? "⟳" : status === "success" ? "✓" : status === "error" ? "✗" : "⚡";
    badge.querySelector(".prelab-text").textContent = text;
  }

  // ─── Message Listener ─────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case "PRELAB_PING":
        sendResponse({ ok: true, url: location.href });
        return false;

      case "PRELAB_SCRAPE":
        // Route: ujian.gunadarma.ac.id scrapes one question at a time
        (isUjianGunadarma() ? ujianScrapeCurrentQuestion() : scrapeQuestions()).then(questions => {
          chrome.storage.local.set({ prelab_questions_cache: questions });
          // Debug: log extracted question texts to verify math extraction
          questions.forEach((q, i) => {
            console.log(`[UGLab] Q${i+1} (${q.type}) text:`, q.text.slice(0, 500));
            if (q.options) q.options.forEach((o, j) => console.log(`  [Opsi ${j}]:`, o.text));
          });
          const meta = questions.map(q => ({
            index: q.index,
            type: q.type,
            text: q.text.slice(0, 100),
            hasImages: q.images && q.images.length > 0,
          }));
          sendResponse({ questions: meta, count: questions.length });
        });
        return true;

      case "PRELAB_ANSWERS":
        handleAnswers(msg.answers);
        sendResponse({ ok: true });
        return false;

      case "PRELAB_ERROR":
        updateStatus("error", "Error: " + msg.error);
        sendResponse({ ok: true });
        return false;

      case "PRELAB_STATUS_UPDATE":
        if (msg.data) updateStatus(msg.data.status, msg.data.text);
        return false;
    }
  });

  let _answersBusy = false;

  async function handleAnswers(answers) {
    if (!Array.isArray(answers)) return;
    if (_answersBusy) { console.warn("[UGLab] handleAnswers: already running, skip duplicate call"); return; }
    _answersBusy = true;
    updateStatus("loading", `Mengisi ${answers.length} jawaban...`);
    let filled = 0;

    if (isUjianGunadarma()) {
      // Ujian: always 1 question, use specialized filler
      const ok = await ujianFillAnswer(answers[0]);
      if (ok) filled = 1;
    } else {
      // Moodle: staggered fill for all questions
      for (let i = 0; i < answers.length; i++) {
        const ok = fillAnswer(answers[i].index !== undefined ? answers[i].index : i, answers[i]);
        if (ok) filled++;
        await new Promise(r => setTimeout(r, 400));
      }
    }

    updateStatus("success", `✓ ${filled}/${answers.length} terjawab`);

    // Step 2: Auto-Proceed (Loop Logic)
    const store = await chrome.storage.local.get("prelab_auto_loop");
    if (store.prelab_auto_loop) {
       await autoProceed();
    }
    _answersBusy = false;
  }

  // ─── Navigation helper — submit form directly, bypassing all JS handlers ────
  function submitMoodleNav(navValue) {
    const form = document.querySelector("#responseform") ||
                 document.querySelector("form[action*='processattempt']") ||
                 document.querySelector("form[method='post']");
    if (!form) { console.error("[UGLab] submitMoodleNav: form not found"); return false; }

    let navInput = form.querySelector("input[name='next']");
    if (navInput) {
      navInput.value = navValue;
    } else {
      navInput = document.createElement("input");
      navInput.type = "hidden";
      navInput.name = "next";
      navInput.value = navValue;
      form.appendChild(navInput);
    }
    console.log(`[UGLab] submitMoodleNav → "${navValue}" via form#${form.id || "(no-id)"}`);
    HTMLFormElement.prototype.submit.call(form);
    return true;
  }

  // ─── Navigate to next page or stop loop if Finish found ─────────────────────
  async function navigateNext() {
    const nextBtn =
      document.querySelector('input[name="next"][value="Next page"]') ||
      document.querySelector('input[name="next"][data-initial-value="Next page"]') ||
      document.querySelector('#mod_quiz-next-nav:not([value*="Finish"])');

    if (nextBtn) {
      updateStatus("loading", "➡️ Menuju halaman berikutnya...");
      await sleep(600);
      // Try .click() first; if page doesn't unload within 1.5s, force via form submit
      nextBtn.click();
      await sleep(1500);
      if (document.body.contains(nextBtn)) {
        console.warn("[UGLab] navigateNext: click() stalled — forcing form submit");
        submitMoodleNav("Next page");
      }
      return;
    }

    const finishBtn =
      document.querySelector('input[name="next"][value*="Finish"]') ||
      document.querySelector('#mod_quiz-next-nav[value*="Finish"]');

    if (finishBtn) {
      updateStatus("success", "🏁 Loop Selesai. Silakan klik Finish Attempt manual.");
      await chrome.storage.local.remove(["prelab_auto_loop", "prelab_loop_state"]);
    } else {
      console.warn("[UGLab] navigateNext: neither Next nor Finish button found");
    }
  }

  // ─── autoProceed: state-machine driven ──────────────────────────────────────
  // Check button causes full page reload. We use prelab_loop_state to communicate
  // across the reload boundary:
  //   "answer"   → (default) answer questions then click Check
  //   "navigate" → post-check reload: skip answering, click Next page directly
  async function autoProceed() {
    if (isUjianGunadarma()) {
      await ujianAutoProceed();
      return;
    }

    const checkBtns = Array.from(document.querySelectorAll(
      'button.submit[type="submit"][name$="-submit"]'
    )).filter(btn => !btn.disabled && btn.offsetParent !== null);

    if (checkBtns.length > 0) {
      // Signal next page load to navigate instead of re-answering
      await chrome.storage.local.set({ prelab_loop_state: "navigate" });
      updateStatus("loading", "⚡ Check...");
      await sleep(400);
      const btn = checkBtns[0];
      const opts = { bubbles: true, cancelable: true, view: window };
      btn.scrollIntoView({ behavior: "auto", block: "center" });
      btn.dispatchEvent(new MouseEvent("mousedown", opts));
      btn.focus();
      if (btn.form && typeof btn.form.requestSubmit === "function") {
        btn.form.requestSubmit(btn);
      } else {
        btn.click();
      }
      btn.dispatchEvent(new MouseEvent("mouseup", opts));
      // Page will reload — execution stops here
      return;
    }

    // No Check button: navigate directly
    await navigateNext();
  }

  // ─── Auto-Start Loop on Load ─────────────────────────────────────────────────
  async function checkAutoLoop() {
    const store = await chrome.storage.local.get(["prelab_auto_loop", "prelab_loop_state"]);
    if (!store.prelab_auto_loop) return;

    if (isUjianGunadarma()) {
      await ujianAutoLoopEntry();
      return;
    }

    // Finish/summary page: stop loop
    const isFinishPage = document.querySelector('input[name="next"][value*="Finish"], .endtestlink');
    if (isFinishPage && !document.querySelector('.que')) {
      updateStatus("success", "🏁 Loop Selesai. Silakan klik Finish Attempt manual.");
      await chrome.storage.local.remove(["prelab_auto_loop", "prelab_loop_state"]);
      return;
    }

    const loopState = store.prelab_loop_state || "answer";
    console.log(`[UGLab] checkAutoLoop: state="${loopState}"`);

    if (loopState === "navigate") {
      // Post-Check reload: reset state then navigate to next question
      await chrome.storage.local.set({ prelab_loop_state: "answer" });
      await sleep(600);
      await navigateNext();
      return;
    }

    // Default: answer questions on this page
    updateStatus("loading", "⚡ Loop Aktif: Scan soal...");
    await sleep(800);
    chrome.runtime.sendMessage({ type: "PRELAB_START_AUTO" });
  }

  // Run on startup
  setTimeout(checkAutoLoop, 600);

  // ─── Expose global fill function (for scripting.executeScript fallback) ──────
  window.__prelabFill = function(answers) {
    handleAnswers(answers);
  };

  // If background stored answers while this page was loading, consume them now
  if (typeof window.__prelabPendingAnswers !== "undefined") {
    setTimeout(() => handleAnswers(window.__prelabPendingAnswers), 500);
    delete window.__prelabPendingAnswers;
  }

  // ─── Storage-based backup listener ───────────────────────────────────────────
  // When the service worker dies mid-flight, background.js stores answers in
  // chrome.storage.local. We listen for that change here as a safety net.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.prelab_answers_pending?.newValue) {
      const { answers } = changes.prelab_answers_pending.newValue;
      handleAnswers(answers);
      chrome.storage.local.remove("prelab_answers_pending");
    }
  });

  // Also check on load in case the page loaded AFTER answers were stored
  chrome.storage.local.get("prelab_answers_pending").then(data => {
    if (data.prelab_answers_pending?.answers) {
      setTimeout(() => {
        handleAnswers(data.prelab_answers_pending.answers);
        chrome.storage.local.remove("prelab_answers_pending");
      }, 800);
    }
  });

  // Init badge
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createStatusBadge);
  } else {
    createStatusBadge();
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // ─── UJIAN.GUNADARMA.AC.ID — ASP.NET Custom Exam Engine ───────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Structure observed from the exam page:
  //   • One question displayed at a time
  //   • Question text: div/span with the question body
  //   • Radio buttons: input[type=radio] with sibling text / label
  //   • "Belum dijawab" is the default no-answer placeholder — must be excluded
  //   • Navigation buttons:
  //       - "SIMPAN NOMOR N"         → save only
  //       - "SIMPAN & TAMPILKAN NOMOR N" → save and go to next
  //   • Numbered question tabs at the top (1,2,3,...)
  //   • Timer displayed: "SISA WAKTU DI BAGIAN X"

  // ─── Helper: find question number currently shown ─────────────────────────
  function ujianGetCurrentQuestionNumber() {
    // Active/selected tab button usually has a different style (pink/selected)
    // Try to find the active numbered tab
    const activeBtn = document.querySelector(
      'input[type=button][style*="background-color: rgb(255"], ' +  // pink active
      'input[type=button].selected, ' +
      'td.selectedTab input, ' +
      'td[style*="background-color"] input[type=button]'
    );
    if (activeBtn) {
      const num = parseInt(activeBtn.value, 10);
      if (!isNaN(num)) return num;
    }
    // Fallback: look for "SIMPAN NOMOR N" button
    const saveBtn = Array.from(document.querySelectorAll('input[type=button], a[href*="javascript"]'))
      .find(el => /SIMPAN NOMOR\s*(\d+)/i.test(el.value || el.textContent));
    if (saveBtn) {
      const m = (saveBtn.value || saveBtn.textContent).match(/SIMPAN NOMOR\s*(\d+)/i);
      if (m) return parseInt(m[1], 10);
    }
    return 1;
  }

  // ─── Helper: total number of questions in the exam ───────────────────────
  function ujianGetTotalQuestions() {
    // Count numbered navigation tabs
    const tabs = document.querySelectorAll(
      'input[type=button][value="1"], ' +  // find all numbered buttons by pattern
      'td input[type=button]'
    );
    // Better: look for all numeric-value tab buttons
    const numericBtns = Array.from(document.querySelectorAll('input[type=button]'))
      .filter(btn => /^\d+$/.test((btn.value || "").trim()));
    if (numericBtns.length > 0) {
      return Math.max(...numericBtns.map(b => parseInt(b.value, 10)));
    }
    // Fallback: look for "TAMPILKAN NOMOR N" to find max
    const nextBtn = ujianFindNextButton();
    if (nextBtn) {
      const m = (nextBtn.value || nextBtn.textContent || "").match(/(\d+)/);
      if (m) return parseInt(m[1], 10) + 10; // rough estimate
    }
    return 0;
  }

  // ─── Helper: find the "SIMPAN & TAMPILKAN NOMOR N+1" button ─────────────
  function ujianFindNextButton() {
    // Button text patterns for ASP.NET exam navigation
    const all = Array.from(document.querySelectorAll('input[type=button], input[type=submit], a'));
    // Prefer "SIMPAN & TAMPILKAN NOMOR" (save + go next)
    const saveAndShow = all.find(el => {
      const t = (el.value || el.textContent || "").toUpperCase();
      return t.includes("SIMPAN") && t.includes("TAMPILKAN");
    });
    if (saveAndShow) return saveAndShow;
    // Fallback: "SIMPAN & TAMPILKAN" without NOMOR
    return all.find(el => {
      const t = (el.value || el.textContent || "").toUpperCase();
      return t.includes("TAMPILKAN");
    }) || null;
  }

  // ─── Helper: find the "SIMPAN NOMOR N" (save only) button ────────────────
  function ujianFindSaveButton() {
    const all = Array.from(document.querySelectorAll('input[type=button], input[type=submit], a'));
    return all.find(el => {
      const t = (el.value || el.textContent || "").toUpperCase();
      return t.includes("SIMPAN") && !t.includes("TAMPILKAN");
    }) || null;
  }

  // ─── Scrape the current single question shown on the page ────────────────
  async function ujianScrapeCurrentQuestion() {
    const q = { index: 0, type: "multichoice", text: "", options: [], images: [] };

    // 1. Extract question text
    //    The question body is typically inside a table cell or div with larger text.
    //    We look for common ASP.NET exam patterns:
    const textCandidates = [
      document.querySelector('#lblSoal, #lblQuestion, #questionText, .question-text, [id*="lblSoal"], [id*="Soal"]'),
      document.querySelector('td[id*="soal"], td[id*="question"], span[id*="soal"]'),
      // Table-cell heuristic: find a <td> or <div> that contains radio buttons' parent
      (() => {
        const firstRadio = document.querySelector('input[type=radio]');
        if (!firstRadio) return null;
        // Walk up to find a table row or container that likely holds the question
        let el = firstRadio.parentElement;
        for (let i = 0; i < 6; i++) {
          if (!el) break;
          const prev = el.previousElementSibling;
          if (prev && prev.innerText && prev.innerText.trim().length > 20) return prev;
          el = el.parentElement;
        }
        return null;
      })()
    ];

    for (const cand of textCandidates) {
      if (cand && cand.innerText && cand.innerText.trim().length > 5) {
        q.text = cand.innerText.trim().replace(/\s+/g, ' ').slice(0, 5000);
        break;
      }
    }

    // Fallback: scrape entire visible text block above the radio buttons
    if (!q.text) {
      const firstRadio = document.querySelector('input[type=radio]');
      if (firstRadio) {
        // Get the closest table/div container
        let container = firstRadio.closest('table, form, .content, #content, body');
        if (container) {
          const clone = container.cloneNode(true);
          // Remove option rows to isolate question text
          clone.querySelectorAll('input, select, button').forEach(e => e.remove());
          const raw = (clone.innerText || clone.textContent || '').trim();
          // Take content before the first option
          q.text = raw.slice(0, 3000);
        }
      }
    }

    // 2. Extract radio options (excluding "Belum dijawab" placeholder)
    const BELUM_DIJAWAB_RE = /belum\s*dijawab/i;
    const radios = Array.from(document.querySelectorAll('input[type=radio]'));
    q.options = [];
    radios.forEach((radio, idx) => {
      // Get label text: check <label for=id>, sibling text, or parent text
      let labelText = "";
      const labelEl = radio.id
        ? document.querySelector(`label[for="${radio.id}"]`)
        : null;
      if (labelEl) {
        labelText = labelEl.innerText.trim();
      } else {
        // Sibling text node or parent td/span
        const parent = radio.parentElement;
        if (parent) {
          const clone = parent.cloneNode(true);
          clone.querySelectorAll('input').forEach(e => e.remove());
          labelText = (clone.innerText || clone.textContent || '').trim();
        }
      }

      // Skip the "Belum dijawab" placeholder option
      if (BELUM_DIJAWAB_RE.test(labelText)) return;
      if (!labelText) return;

      q.options.push({
        value: radio.value,
        text: labelText,
        input: radio,
      });
    });

    // 3. Extract images from question area
    const qImages = await extractImages(document.body);
    q.images = qImages;

    // 4. Store current question number for tracking
    q.ujianQuestionNumber = ujianGetCurrentQuestionNumber();
    q.ujianTotalQuestions = ujianGetTotalQuestions();

    console.log(`[UGLab/Ujian] Scraped Q${q.ujianQuestionNumber}: "${q.text.slice(0, 60)}..." | ${q.options.length} options`);
    return [q]; // Always array of 1 for ujian
  }

  // ─── Fill answer for ujian.gunadarma.ac.id ───────────────────────────────
  async function ujianFillAnswer(answer) {
    if (!answer) return false;
    const BELUM_DIJAWAB_RE = /belum\s*dijawab/i;
    const normalize = s => String(s || '')
      .replace(/\\n/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim();
    const jawabanNorm = normalize(answer.jawaban);

    const radios = Array.from(document.querySelectorAll('input[type=radio]'))
      .filter(r => {
        // Build label text for this radio
        const labelEl = r.id ? document.querySelector(`label[for="${r.id}"]`) : null;
        let t = '';
        if (labelEl) {
          t = labelEl.innerText.trim();
        } else {
          const p = r.parentElement;
          if (p) {
            const c = p.cloneNode(true);
            c.querySelectorAll('input').forEach(e => e.remove());
            t = (c.innerText || c.textContent || '').trim();
          }
        }
        // Exclude "Belum dijawab"
        return !BELUM_DIJAWAB_RE.test(t);
      });

    // Build options map
    const options = radios.map((r, idx) => {
      const labelEl = r.id ? document.querySelector(`label[for="${r.id}"]`) : null;
      let text = '';
      if (labelEl) {
        text = labelEl.innerText.trim();
      } else {
        const p = r.parentElement;
        if (p) {
          const c = p.cloneNode(true);
          c.querySelectorAll('input').forEach(e => e.remove());
          text = (c.innerText || c.textContent || '').trim();
        }
      }
      return { r, idx, text, textNorm: normalize(text) };
    });

    let target = null;

    // Strategy 1: Exact match
    if (jawabanNorm) {
      target = options.find(o => o.textNorm === jawabanNorm)?.r || null;
    }
    // Strategy 2: Substring match
    if (!target && jawabanNorm) {
      target = options.find(o =>
        o.textNorm.includes(jawabanNorm) ||
        (jawabanNorm.includes(o.textNorm) && o.textNorm.length > 3)
      )?.r || null;
    }
    // Strategy 3: index_pilihan fallback
    if (!target && typeof answer.index_pilihan === 'number' && options[answer.index_pilihan]) {
      target = options[answer.index_pilihan].r;
    }

    if (!target) {
      console.warn(`[UGLab/Ujian] No radio match for: "${jawabanNorm}"`);
      return false;
    }

    // Click the radio
    target.scrollIntoView({ behavior: 'auto', block: 'center' });
    target.click();
    target.checked = true;
    target.dispatchEvent(new Event('change', { bubbles: true }));
    highlightFilled(target.parentElement || target);
    console.log(`[UGLab/Ujian] Filled: "${options.find(o => o.r === target)?.text}"`);

    // Wait briefly for any JS handlers on the page
    await sleep(300);
    return true;
  }

  // ─── Auto-proceed for ujian.gunadarma.ac.id ──────────────────────────────
  async function ujianAutoProceed() {
    const nextBtn = ujianFindNextButton();
    if (!nextBtn) {
      // No next button → we're on the last question
      const saveBtn = ujianFindSaveButton();
      if (saveBtn) {
        updateStatus("loading", "💾 Menyimpan jawaban terakhir...");
        await sleep(800);
        saveBtn.click();
        await sleep(1500);
      }
      updateStatus("success", "🏁 Semua soal selesai! Periksa dan submit ujian secara manual.");
      await chrome.storage.local.remove("prelab_auto_loop");
      return;
    }

    const btnText = (nextBtn.value || nextBtn.textContent || '').toUpperCase();
    updateStatus("loading", `➡️ ${btnText.slice(0, 40)}...`);
    await sleep(800);

    nextBtn.scrollIntoView({ behavior: 'auto', block: 'center' });
    nextBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    nextBtn.click();
    nextBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    console.log('[UGLab/Ujian] Clicked next:', btnText);
    // The page will reload or update via ASP.NET postback — checkAutoLoop fires on next load
  }

  // ─── Auto-loop entry point for ujian ─────────────────────────────────────
  async function ujianAutoLoopEntry() {
    // Check if there are any unanswered questions left
    const nextBtn = ujianFindNextButton();
    if (!nextBtn) {
      // Looks like last question page
      updateStatus("success", "🏁 Loop Selesai! Periksa jawaban lalu submit ujian.");
      await chrome.storage.local.remove("prelab_auto_loop");
      return;
    }

    updateStatus("loading", "⚡ Loop Ujian Aktif: Scan soal...");
    await sleep(800); // Wait for DOM to stabilize after page load
    chrome.runtime.sendMessage({ type: "PRELAB_START_AUTO" });
  }

})();
