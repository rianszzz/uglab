# Graph Report - uglab-2  (2026-10-11)

## Corpus Check
- Corpus is ~21,645 words - fits in a single context window. You may not need a graph.

## Summary
- 134 nodes · 256 edges · 12 communities (9 shown, 3 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 16 edges (avg confidence: 0.88)
- Token cost: 1,200 input · 450 output

## Community Hubs (Navigation)
- LMS Question Scraper & Parsing
- Extension Manifest & Packaging
- Popup UI State & Elements
- Background AI Service & Groq API
- AI Web Injector & Response Extraction
- Exam Auto-Navigation & Loop Runner
- Popup Controller & Scanning Logic
- Execution Flow & Lifecycle State
- Core Architecture & Message Bus
- Developer Tooling & MCP Setup
- Extension Branding & Popup View
- Project Skills & Guidelines

## God Nodes (most connected - your core abstractions)
1. `fillAnswer()` - 11 edges
2. `highlightFilled()` - 10 edges
3. `extractQuestionText()` - 9 edges
4. `startAutoAnswer()` - 8 edges
5. `setStatus()` - 8 edges
6. `log()` - 8 edges
7. `updateStatus()` - 8 edges
8. `setupListeners()` - 7 edges
9. `clearCache()` - 7 edges
10. `handleStart()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `UG Lab Extension Overview` --conceptually_related_to--> `AI Provider Query & Injection Flow`  [INFERRED]
  README.md → src/ai-injector.js
- `UG Lab Extension Overview` --conceptually_related_to--> `LMS Content Script & DOM Mutation Pipeline`  [INFERRED]
  README.md → src/lms-content.js
- `Popup UI Layout` --references--> `UG Lab Brand Logo`  [EXTRACTED]
  popup.html → icons/logo.png
- `Chrome Extension Messaging Bus` --conceptually_related_to--> `LMS Content Script & DOM Mutation Pipeline`  [INFERRED]
  src/background.js → src/lms-content.js
- `Chrome Extension Messaging Bus` --conceptually_related_to--> `AI Provider Query & Injection Flow`  [INFERRED]
  src/background.js → src/ai-injector.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Chrome Extension Runtime Lifecycle** — src_background, src_lms_content, popup, src_ai_injector [INFERRED 0.95]

## Communities (12 total, 3 thin omitted)

### Community 0 - "LMS Question Scraper & Parsing"
Cohesion: 0.15
Nodes (29): buildFinalCode(), coding(), detectQuestionType(), essay(), extractImages(), extractMethod(), extractQuestionText(), fillAnswer() (+21 more)

### Community 1 - "Extension Manifest & Packaging"
Cohesion: 0.09
Nodes (21): Chrome Extension Action Icons, action, default_icon, default_popup, background, service_worker, content_scripts, 128 (+13 more)

### Community 2 - "Popup UI State & Elements"
Cohesion: 0.10
Nodes (19): btnClear, btnIcon, btnScan, btnStart, btnText, charCount, detectedQuestions, extraPrompt (+11 more)

### Community 3 - "Background AI Service & Groq API"
Cohesion: 0.27
Nodes (12): broadcastToLMS(), buildPrompt(), callGroqAPI(), deliverAnswersToLMS(), getApiKeys(), handleGeminiDone(), handleStart(), parseAnswersFromText() (+4 more)

### Community 4 - "AI Web Injector & Response Extraction"
Cohesion: 0.41
Nodes (11): buildPrompt(), checkForPendingWork(), doWorkWithRequestId(), extractAndRelayResponse(), findBestResponseElement(), hideGeminiOverlay(), injectToWebEngine(), parseAnswersFromText() (+3 more)

### Community 5 - "Exam Auto-Navigation & Loop Runner"
Cohesion: 0.31
Nodes (10): autoProceed(), checkAutoLoop(), createStatusBadge(), navigateNext(), submitMoodleNav(), ujianAutoLoopEntry(), ujianAutoProceed(), ujianFindNextButton() (+2 more)

### Community 6 - "Popup Controller & Scanning Logic"
Cohesion: 0.50
Nodes (8): clearCache(), detectCurrentTab(), log(), scanQuestions(), setStatus(), setupListeners(), toggleLog(), updateStats()

### Community 7 - "Execution Flow & Lifecycle State"
Cohesion: 0.67
Nodes (6): onCompleted(), resetState(), setBtnLoading(), showProgress(), startAutoAnswer(), waitForCompletion()

### Community 8 - "Core Architecture & Message Bus"
Cohesion: 0.67
Nodes (4): UG Lab Extension Overview, AI Provider Query & Injection Flow, LMS Content Script & DOM Mutation Pipeline, Chrome Extension Messaging Bus

## Knowledge Gaps
- **41 isolated node(s):** `npx`, `manifest_version`, `name`, `version`, `description` (+36 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 45 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Chrome Extension Messaging Bus` connect `Core Architecture & Message Bus` to `Background AI Service & Groq API`?**
  _High betweenness centrality (0.468) - this node is a cross-community bridge._
- **Why does `LMS Content Script & DOM Mutation Pipeline` connect `Core Architecture & Message Bus` to `LMS Question Scraper & Parsing`?**
  _High betweenness centrality (0.358) - this node is a cross-community bridge._
- **Why does `AI Provider Query & Injection Flow` connect `Core Architecture & Message Bus` to `AI Web Injector & Response Extraction`?**
  _High betweenness centrality (0.105) - this node is a cross-community bridge._
- **What connects `npx`, `manifest_version`, `name` to the rest of the system?**
  _41 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Extension Manifest & Packaging` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `Popup UI State & Elements` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._