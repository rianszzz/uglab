# Graph Report - uglab-2  (2026-10-05)

## Corpus Check
- Corpus is ~21,252 words - fits in a single context window. You may not need a graph.

## Summary
- 169 nodes · 291 edges · 13 communities (7 shown, 6 thin omitted)
- Extraction: 94% EXTRACTED · 5% INFERRED · 1% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- LMS Form Filling
- Popup UI & Scan
- Extension Manifest
- Docs & Design Concepts
- AI API Calls
- Architecture & Messages
- Web Engine Injection
- Cursor MCP Config
- Icon 48
- Icon 128
- Icon 16
- Icon 32
- Logo

## God Nodes (most connected - your core abstractions)
1. `fillAnswer()` - 11 edges
2. `Popup UI (popup.html)` - 11 edges
3. `highlightFilled()` - 10 edges
4. `extractQuestionText()` - 9 edges
5. `startAutoAnswer()` - 8 edges
6. `setStatus()` - 8 edges
7. `log()` - 8 edges
8. `updateStatus()` - 8 edges
9. `Supported Question Types` - 8 edges
10. `setupListeners()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Space Grotesk (flagged as overused convergence choice)` --conceptually_related_to--> `Popup UI (popup.html)`  [AMBIGUOUS]
  -p/SKILL.md → popup.html
- `Frontend Design Skill` --conceptually_related_to--> `Popup UI (popup.html)`  [AMBIGUOUS]
  -p/SKILL.md → popup.html
- `Popup UI (popup.html)` --conceptually_related_to--> `Popup UI`  [INFERRED]
  popup.html → README.md
- `Loop Mode (Experimental: Auto Check & Auto Next Page)` --conceptually_related_to--> `Auto-Jawab Praktikum`  [INFERRED]
  popup.html → README.md
- `Web Engine: Gemini` --conceptually_related_to--> `Gemini AI`  [INFERRED]
  popup.html → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Auto-Jawab Message Pipeline** — readme_popup_ui, readme_msg_prelab_start, readme_background_service_worker, readme_ai_tab_injector, readme_msg_ai_result, readme_msg_prelab_answers, readme_lms_content_script [EXTRACTED 1.00]
- **Supported Question Type Set** — readme_tipe_soal, readme_q_pilihan_ganda, readme_q_true_false, readme_q_multi_select, readme_q_isian_singkat, readme_q_essay, readme_q_coding, readme_q_multi_kotak [EXTRACTED 1.00]
- **Web Mode Engine Selection** — popup_mode_web, popup_engine_gemini, popup_engine_chatgpt, popup_engine_claude [EXTRACTED 1.00]

## Communities (13 total, 6 thin omitted)

### Community 0 - "LMS Form Filling"
Cohesion: 0.12
Nodes (39): autoProceed(), buildFinalCode(), checkAutoLoop(), coding(), createStatusBadge(), detectQuestionType(), essay(), extractImages() (+31 more)

### Community 1 - "Popup UI & Scan"
Cohesion: 0.12
Nodes (33): btnClear, btnIcon, btnScan, btnStart, btnText, charCount, clearCache(), detectCurrentTab() (+25 more)

### Community 2 - "Extension Manifest"
Cohesion: 0.10
Nodes (20): action, default_icon, default_popup, background, service_worker, content_scripts, 128, 16 (+12 more)

### Community 3 - "Docs & Design Concepts"
Cohesion: 0.15
Nodes (15): Frontend Design Skill, Web Engine: ChatGPT, Web Engine: Claude, Web Engine: Gemini, Extra Prompt Textarea (Instruksi Tambahan), Loop Mode (Experimental: Auto Check & Auto Next Page), API Mode (Groq/Gemini API), Web Mode (Visual Gemini/ChatGPT) (+7 more)

### Community 4 - "AI API Calls"
Cohesion: 0.23
Nodes (14): broadcastToLMS(), buildPrompt(), callGeminiAPI(), callGroqAPI(), deliverAnswersToLMS(), getNextGroqKey(), GROQ_API_KEYS, handleGeminiDone() (+6 more)

### Community 5 - "Architecture & Messages"
Cohesion: 0.15
Nodes (15): AI Tab Injector, Background Service Worker, LMS Content Script, AI_RESULT message, PRELAB_ANSWERS message, PRELAB_START message, Popup UI, Coding (CodeMirror & Ace Editor) (+7 more)

### Community 6 - "Web Engine Injection"
Cohesion: 0.36
Nodes (11): buildPrompt(), checkForPendingWork(), doWorkWithRequestId(), extractAndRelayResponse(), findBestResponseElement(), hideGeminiOverlay(), injectToWebEngine(), parseAnswersFromText() (+3 more)

## Ambiguous Edges - Review These
- `Popup UI (popup.html)` → `Frontend Design Skill`  [AMBIGUOUS]
  popup.html · relation: conceptually_related_to
- `Popup UI (popup.html)` → `Space Grotesk (flagged as overused convergence choice)`  [AMBIGUOUS]
  popup.html · relation: conceptually_related_to
- `App Icon (48px)` → `Extension Icon Concept`  [AMBIGUOUS]
  icons/icon48.png · relation: conceptually_related_to

## Knowledge Gaps
- **54 isolated node(s):** `npx`, `manifest_version`, `name`, `version`, `description` (+49 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 62 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Popup UI (popup.html)` and `Frontend Design Skill`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Popup UI (popup.html)` connect `Docs & Design Concepts` to `Popup UI & Scan`, `Architecture & Messages`?**
  _High betweenness centrality (0.103) - this node is a cross-community bridge._
- **What connects `npx`, `manifest_version`, `name` to the rest of the system?**
  _54 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `LMS Form Filling` be split into smaller, more focused modules?**
  _Cohesion score 0.11846689895470383 - nodes in this community are weakly interconnected._
- **What is the exact relationship between `Popup UI (popup.html)` and `Space Grotesk (flagged as overused convergence choice)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Popup UI` connect `Architecture & Messages` to `Docs & Design Concepts`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Should `Popup UI & Scan` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._