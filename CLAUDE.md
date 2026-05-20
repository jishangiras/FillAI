# FillAI — Full Project Context

## What Is FillAI?
FillAI is a Chrome/Firefox browser extension that fills web forms from pasted or spoken natural language. Users paste notes (or dictate) and FillAI maps them to the right form fields using on-device AI — no data leaves the browser, no account required.

**Key value**: Works on any form on any website. Inference runs on-device via WebLLM (WebGPU), Transformers.js (WebAssembly), or a regex heuristic fallback. Fills fields with colour-coded confidence rings (green/amber/red) and an approval bar before committing.

**Project path**: `/Users/jishangiras/Dropbox/Developer/Projects/FillAi`

## Quick Start
```bash
npm install
npm run build:chrome          # builds to dist/chrome/
# Then: chrome://extensions → Load unpacked → dist/chrome/
npm run build                 # builds both Chrome + Firefox
```
After every code change: rebuild → Reload extension tile in `chrome://extensions`.

## Current State (May 2026)
- Core form-fill pipeline: ✅ working
- Voice input via Web Speech API: ✅ working
- Custom fields (up to 30): ✅ working
- Donation button in popup.html footer: ✅ `https://donate.stripe.com/9B65kD1fw7tA0WQarY2sM02`
- WebLLM (WebGPU inference): ✅ works, ~800MB first-run model download
- Firefox: ✅ separate manifest, no offscreen document
- Stripe / payments: Stripe Payment Link only — no backend

## Donations
See `STRIPE.md` in this folder for full details.
- **Link**: https://donate.stripe.com/9B65kD1fw7tA0WQarY2sM02
- Embedded in `popup.html` (`.donate` section) and `src/content.ts` (`.fillai-donate`)
- Stripe account: 1Labs (`acct_18hXnKE3FNscJyVT`)

---

# FillAI — AI Coding Context

FillAI is a Chrome/Firefox Manifest V3 browser extension that fills web forms from pasted or spoken natural language. All inference runs entirely on-device; no data leaves the browser.

---

## Architecture overview

```
User clicks extension icon
  └─> background.ts (action.onClicked)
        └─> chrome.tabs.sendMessage FILLAI_OPEN_PANEL
              └─> content.ts (runs on every page)
                    ├─> renderInput()         — paste/voice UI panel
                    ├─> generateDraft()       — sends FILLAI_INFER to background
                    │     └─> background.ts routes to offscreen doc (Chrome)
                    │           └─> ai/ai-core.ts: WebLLM → Transformers.js → heuristic
                    ├─> enterPreviewMode()    — fills fields in-page with confidence rings
                    │     └─> form-filler.ts: previewFill() + showApprovalBar()
                    ├─> exitPreviewApprove()  — clearPreviewMarkers(), keeps values
                    ├─> exitPreviewRevert()   — revertPreview(), reopens panel
                    └─> startDictation()      — posts to pageVoiceBridge.js
                          └─> page-voice-bridge.ts (injected page-context script)
                                └─> Web Speech API (SpeechRecognition)
```

### Why there is a separate page-voice-bridge.ts

Chrome's `SpeechRecognition` API can only run in the **page context**, not in an extension content script context. `page-voice-bridge.ts` is injected as a `<script>` tag so it runs in the page origin. It communicates with `content.ts` via `window.postMessage` using `source` discriminators (`fillai-page` ↔ `fillai-content`).

---

## File map

| File | Role |
|------|------|
| `src/content.ts` | In-page UI (panel HTML, voice flow, in-context preview fill, settings) |
| `src/page-voice-bridge.ts` | Page-context Web Speech API wrapper |
| `src/background.ts` | Extension action handler, inference routing, offscreen setup |
| `src/ai/ai-core.ts` | Inference pipeline: WebLLM → Transformers.js → heuristic |
| `src/ai/heuristic.ts` | Regex/keyword form-field matching; entity extraction from free-form text |
| `src/ai/prompt.ts` | Prompt builder for LLM extraction (includes profile + custom fields) |
| `src/ai/inference-worker.ts` | Offscreen document entry point |
| `src/form-detector.ts` | Scans page DOM for visible form fields, excludes FillAI panel |
| `src/form-filler.ts` | `fillFields`, `previewFill`, `revertPreview`, `clearPreviewMarkers` |
| `src/shared/types.ts` | Shared TypeScript interfaces (`FieldMeta`, `DraftResult`, `UserPreferences`, `CustomField`, …) |
| `src/shared/browser.ts` | Chrome/Firefox compat shim |
| `src/shared/storage.ts` | `chrome.storage.local` helpers |
| `src/ui/styles.css` | All panel + FAB styles (inlined at build time) |
| `src/manifest.chrome.json` | Chrome manifest (MV3) |
| `src/manifest.firefox.json` | Firefox manifest (MV3) |
| `vite.config.ts` | Multi-entry Vite build; `__FILLAI_BROWSER__` define flag |
| `test-form.html` | Local test page (no backend needed) |

---

## Build system

- **Framework**: Vite 6, TypeScript 5, no React/Vue
- **Build outputs**: `dist/chrome/` and `dist/firefox/`
- **Multi-entry**: Each file in `vite.config.ts → rollupOptions.input` becomes its own JS file (no bundling together).
- **CSS**: `styles.css` is imported with `?inline` and injected as a `<style>` tag at runtime.

### Build commands

```bash
# Chrome only (fastest for dev)
npm run build:chrome

# Both browsers
npm run build

# Typecheck only
./node_modules/.bin/tsc --noEmit
```

If Homebrew node fails, use the bundled runtime:
```bash
PATH=/Users/jishangiras/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
```

After every build: go to `chrome://extensions` → click **Reload** on the FillAI tile.

---

## Key data types (src/shared/types.ts)

```typescript
FieldMeta        // Describes one form field (uid, label, type, options, …)
DraftField       // Proposed value for one field (uid, proposedValue, confidence 0–1)
DraftResult      // { fields: DraftField[], engine, warnings, elapsedMs }
InferenceRequest // { rawInput, fields: FieldMeta[], preferences }
CustomField      // { label: string; value: string }  — user-defined key/value pairs
UserPreferences  // { modelId, preferWebGpu, autoOpenOnForms, commonProfile, customFields }
RuntimeMessage   // Union of all chrome.runtime.sendMessage payloads
```

`FieldMeta.uid` is the stable cross-process key. `form-detector.ts` writes `data-fillai-uid` onto each element, and `form-filler.ts` reads it back.

`customFields` (up to 30) are stored in `UserPreferences` and flow into both the heuristic and the LLM prompt as additional known profile data.

---

## Inference pipeline (src/ai/ai-core.ts)

Three-tier fallback in priority order:

1. **WebLLM** (`@mlc-ai/web-llm`) — runs a quantised LLM via WebGPU in an offscreen document. Default model: `Llama-3.2-1B-Instruct-q4f16_1-MLC`. First run downloads ~800 MB.
2. **Transformers.js** (`@huggingface/transformers`) — `Xenova/flan-t5-base` (~250 MB) via WebAssembly/WebGPU.
3. **Heuristic** — regex/keyword matching in `src/ai/heuristic.ts`. Always works, lowest quality.

`heuristicDraft(rawInput, fields, profile, customFields)`:
- Extracts entities from free-form text (name, phone, email, address, postal code, company, DOB, notes, etc.)
- Merges with `commonProfile` (explicit profile overrides text)
- Fuzzy-matches `customFields[].label` against each form field's haystack; custom field wins over heuristic, confidence 0.85

Chrome routes inference through an offscreen document (to avoid blocking the service worker). Firefox runs inference inline.

---

## Preview fill UX (src/content.ts + src/form-filler.ts)

After `generateDraft()` succeeds:

1. Panel is removed (`panel?.remove()`)
2. `previewFill(fields)` fills each form field with its proposed value and applies a coloured CSS `outline` ring:
   - `.fillai-ring-high` (green) — confidence ≥ 0.75
   - `.fillai-ring-medium` (amber) — confidence ≥ 0.45
   - `.fillai-ring-low` (red, pulsing) — confidence < 0.45
3. Original values are saved in `previewOriginals: Map<uid, string>` for revert
4. A fixed approval bar (`fillai-approval-bar`) appears at the bottom of the viewport
5. **Approve** → `clearPreviewMarkers()` removes rings, keeps values, shows toast
6. **Edit** → `revertPreview()` restores originals, removes rings, reopens input panel

Use CSS `outline` (not `border`) for rings — it doesn't shift layout.

---

## Voice input (src/content.ts + src/page-voice-bridge.ts)

### Message flow

```
content.ts                         page-voice-bridge.ts (page context)
─────────                          ──────────────────────────────────
ensureVoiceBridge()  →  injects pageVoiceBridge.js as <script>
                    ←   FILLAI_VOICE_READY   (bridge loaded & listening)
startDictation()
  postStartVoice()  →   FILLAI_START_VOICE
                    ←   FILLAI_VOICE_START   (recognition.onstart)
                    ←   FILLAI_VOICE_RESULT  (interim + final transcript)
                    ←   FILLAI_VOICE_ERROR   (e.g. not-allowed, audio-capture)
  stopDictation()   →   FILLAI_STOP_VOICE
                    ←   FILLAI_VOICE_END     (recognition.onend)
```

### Critical constraints

- `getUserMedia` must **not** be called inside the `message` event handler — there is no user gesture in that context. Calling it there causes Chrome to fail or grant-then-revoke the stream, making SpeechRecognition start and immediately stop.
- SpeechRecognition handles microphone permissions natively. Do not pre-warm with `getUserMedia`.
- Chrome fires `onerror("no-speech")` + `onend` after ~7 s of silence. The bridge auto-restarts (up to 8 times).
- `recognition` is set to `null` **before** calling `current.stop()` on external stop, so the subsequent `onend` event is ignored (avoiding a spurious `FILLAI_VOICE_END` post).
- Terminal errors (`not-allowed`, `audio-capture`, `service-not-allowed`) also null `recognition` before posting `FILLAI_VOICE_ERROR` to prevent `onend` from overriding the error message.
- `voiceBridgeReady` gates `postStartVoice()`. If bridge isn't ready, `voiceWaitingForBridge = true` and start fires from the `FILLAI_VOICE_READY` handler.

### Voice UI states

| `activeVoice` | `voiceListening` | Button CSS | Status text |
|---|---|---|---|
| false | false | — | n fields detected |
| true | false | `.active` | Starting microphone… |
| true | true | `.active.fillai-listening` (pulsing) | Listening — speak now |
| false | false | — | Voice saved. / error |

---

## Settings panel

Three sections:

1. **Your defaults** — fixed 4-field profile grid (name, email, phone, address). Stored in `commonProfile`.
2. **Custom fields** — up to 30 user-defined label/value pairs stored in `customFields[]`. Used by both heuristic and LLM. Matched by fuzzy label comparison against form field haystacks.
3. **AI model & performance** (Advanced `<details>`) — radio card model picker + WebGPU toggle.

`readPreferencesFromPanel()` reads all three sections and merges into `UserPreferences`. All prefs auto-save to `chrome.storage.local` on every input event.

---

## Extension permissions (manifest.chrome.json)

```
activeTab    — query the active tab to inject content scripts
scripting    — executeScript() when content.js isn't already injected
storage      — chrome.storage.local for preferences and draft
offscreen    — offscreen document for inference
host_permissions: <all_urls>  — inject content script on any page
```

`pageVoiceBridge.js` must be listed in `web_accessible_resources` — it is injected as a `<script>` tag from content.ts.

### CSP connect-src

Both manifests include:
```
https://huggingface.co https://*.huggingface.co
https://xethub.hf.co https://*.xethub.hf.co   ← HF model CDN (cas-bridge)
https://raw.githubusercontent.com https://*.githubusercontent.com
https://mlc.ai https://*.mlc.ai
```

`xethub.hf.co` / `cas-bridge.xethub.hf.co` is Hugging Face's XetHub-based model download CDN. **Both domains must remain in connect-src** or Transformers.js model downloads will be blocked by CSP.

---

## UI rules (non-negotiable)

- **No popup-first UX.** Clicking the extension icon always opens the in-page panel via `FILLAI_OPEN_PANEL`.
- **No numeric confidence percentages.** Use colored rings/dots only: green ≥ 0.75, amber ≥ 0.45, red < 0.45.
- **No raw model IDs for regular users.** Model IDs only visible inside the "Advanced" `<details>` block.
- **No raw error messages.** Map all model/network errors to plain English in `userFacingModelWarning()`. "Extension context invalidated" maps to "Extension was updated — please reload this page."
- Panel z-index is `2147483646`; approval bar is `2147483647` (maximum).

---

## Testing workflow

1. `npm run build:chrome`
2. Open `chrome://extensions` → Reload the FillAI extension.
3. Navigate to `http://127.0.0.1:4173/test-form.html` (start `vite preview` if not running) or open `test-form.html` directly.
4. Click the FillAI button in the page corner.

For voice: allow microphone permission for the test origin when Chrome prompts.

**After reloading the extension**, any open tabs with the old content script will show "Extension was updated — please reload this page." when Generate is clicked. This is expected and correct.

---

## Common pitfalls

- **Shadow DOM**: `form-detector.ts` walks shadow roots recursively. Never query `document.querySelectorAll` directly for fields — always go through `detectFields()`.
- **Panel re-render**: `renderInput()` destroys and rebuilds the panel innerHTML. DOM references captured before a call are stale. Re-query after each render.
- **UID stability**: `FieldMeta.uid` is written to `data-fillai-uid` on the actual element. Generate it once per element (checked via `element.dataset.fillaiUid`), never regenerate on re-scan.
- **Offscreen document lifetime**: Chrome kills the offscreen doc after ~30 s of inactivity. `ensureOffscreenDocument()` recreates it if needed.
- **Firefox**: Firefox MV3 does not support `chrome.offscreen`. Inference runs in the background service worker directly.
- **Content script isolation**: Content scripts cannot call `window.SpeechRecognition`. Use the page-voice-bridge pattern.
- **Extension context invalidated**: If the extension is reloaded while a tab has an old content script running, `chrome.runtime.sendMessage` will throw. `generateDraft()` catches this and shows a human-readable reload prompt. Do not let this error propagate uncaught.
- **CSP and HF downloads**: Hugging Face routes model shards through `cas-bridge.xethub.hf.co`. If you see CSP `connect-src` violations for `xethub.hf.co`, add `https://*.xethub.hf.co` to both manifests.
- **rollup native module missing after npm ci**: Delete `node_modules` and `package-lock.json`, then `npm install` fresh. This is a known npm optional-dependency bug with `@rollup/rollup-darwin-x64`.

---

## Donations / Monetisation

FillAI is free. Donations are collected via a Stripe Payment Link embedded in `popup.html`.

- **Stripe donation link**: https://donate.stripe.com/9B65kD1fw7tA0WQarY2sM02
- Stripe product: `prod_UWXxyzFillAI` | Price: `price_1TXTRkE3FNscJyVT...` (custom amount, min $1, default $5)
- Payments go to the 1Labs Stripe account (`acct_18hXnKE3FNscJyVT`)
- The main donate button is in the in-page settings panel (`src/content.ts`, `.fillai-donate`) styled via `src/ui/styles.css`
- The legacy popup also has a donate button in `popup.html` (`.donate` section) styled via `src/popup.css`
- No backend required — Stripe handles everything

To update the link, replace it in `src/content.ts`, the `href` in the `.donate` anchor in `popup.html`, and update this file + `STRIPE.md` at the project root.

---

## Suggested improvements (prioritised)

1. **Microphone permission pre-check UI** — before starting, call `navigator.permissions.query({ name: "microphone" })` and show a clear prompt if denied.
2. **Auto-generate draft after voice stops** — add an option to call `generateDraft()` automatically when `FILLAI_VOICE_END` fires with heard speech.
3. **Saved profiles** — let users save multiple named profiles (work, personal) and switch between them.
4. **Keyboard shortcut** — register a `commands` entry in the manifest (`Alt+Shift+F`) to open the panel without clicking the FAB.
5. **Clipboard paste detection** — listen for `paste` events on the panel textarea and auto-trigger draft generation.
6. **Field-level undo** — keep a stack of previously approved values so a user can revert a mis-fill without refreshing.
7. **Confidence threshold setting** — let users set a minimum confidence below which fields are blocked from auto-fill.
8. **Improved heuristic** — score fields by `autocomplete` attribute (e.g. `given-name`, `email`) before falling back to label text matching.
9. **Firefox offscreen workaround** — move inference to a dedicated Web Worker in Firefox.
10. **E2E test harness** — use Playwright's `chromium.loadExtension()` to run automated end-to-end tests against `test-form.html`.
