import styles from "./ui/styles.css?inline";
import { detectFields } from "./form-detector";
import { fillFields, previewFill, revertPreview, clearPreviewMarkers } from "./form-filler";
import type { DraftField, DraftResult, RuntimeMessage, UserPreferences } from "./shared/types";

const CONTENT_DEFAULT_PREFERENCES: UserPreferences = {
  modelId: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  preferWebGpu: true,
  autoOpenOnForms: true,
  commonProfile: {},
  customFields: []
};

const AI_MODELS = [
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    tier: "Fast",
    detail: "Llama 3.2 · 1 B — Instant results, works on all devices"
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    tier: "Balanced",
    detail: "Llama 3.2 · 3 B — Better accuracy, ~2 GB RAM needed"
  },
  {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    tier: "Precise",
    detail: "Phi-3.5 · 3.8 B — Highest accuracy, needs WebGPU"
  }
] as const;
const DONATION_URL = "https://donate.stripe.com/9B65kD1fw7tA0WQarY2sM02";

let panel: HTMLElement | null = null;
let approvalBar: HTMLElement | null = null;
let rawInput = "";
let draft: DraftResult | null = null;
let preferences: UserPreferences = CONTENT_DEFAULT_PREFERENCES;
let saveDraftTimer = 0;
let activeVoice = false;
let voiceListening = false; // true only after FILLAI_VOICE_START confirmed
let dictationBase = "";
let voiceStartTimer = 0;
let voiceStarted = false;
let voiceHadTranscript = false;
let voiceBridgeReady = false;
let voiceWaitingForBridge = false;

bootstrap();

function bootstrap() {
  if (window.top !== window || document.getElementById("fillai-fab")) return;
  if (detectFields().length === 0) return;
  ensureStyles();

  const fab = document.createElement("button");
  fab.id = "fillai-fab";
  fab.className = "fillai-fab";
  fab.type = "button";
  fab.innerHTML = `${brandMark()}<span>FillAI</span>`;
  fab.addEventListener("click", () => openPanel());
  document.documentElement.append(fab);
  ensureVoiceBridge();
}

function ensureStyles() {
  if (document.getElementById("fillai-styles")) return;
  const style = document.createElement("style");
  style.id = "fillai-styles";
  style.textContent = styles;
  document.documentElement.append(style);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const runtimeMessage = message as RuntimeMessage;
  if (runtimeMessage.type === "FILLAI_COLLECT_FIELDS") {
    sendResponse({ fields: detectFields() });
    return false;
  }
  if (runtimeMessage.type === "FILLAI_OPEN_PANEL") {
    openPanel(runtimeMessage.rawInput);
    sendResponse({ ok: true });
    return false;
  }
  if (runtimeMessage.type === "FILLAI_FILL") {
    sendResponse(fillFields(runtimeMessage.payload.fields));
    return false;
  }
  return false;
});

async function openPanel(initialInput = "") {
  ensureStyles();
  if (!isContextValid()) {
    showStaleContextBanner();
    return;
  }
  const [storedInput, storedPreferences] = await Promise.all([loadPopupDraftForContent(), loadPreferencesForContent()]);
  preferences = storedPreferences;
  rawInput = initialInput || rawInput || storedInput;
  panel?.remove();
  panel = document.createElement("aside");
  panel.className = "fillai-panel";
  renderInput();
  document.documentElement.append(panel);
}

function renderInput(status = "") {
  if (!panel) return;
  panel.innerHTML = `
    <header>
      <div class="fillai-brand">
        ${brandMark()}
        <h2>FillAI</h2>
        <span class="fillai-badge-local">${icon("lock")} On-device</span>
      </div>
      <div class="fillai-header-actions">
        <button class="fillai-icon-button" data-action="settings" type="button" title="Settings" aria-label="Settings">${icon("settings")}</button>
        <button class="fillai-icon-button" data-action="close" type="button" title="Close FillAI" aria-label="Close FillAI">${icon("close")}</button>
      </div>
    </header>
    <section class="fillai-grid">
      <label>
        <span class="fillai-label-hint">Paste or speak your info — FillAI fills the form for you.</span>
        <textarea rows="5" placeholder="e.g. My name is Priya Shah, email priya@example.com, phone 416-555-0199, 200 Bay St Toronto ON M5J 2J2…"></textarea>
      </label>
      <div class="fillai-privacy-strip">
        ${icon("shield")}
        <span>100% on-device &nbsp;·&nbsp; 🔒 Medical, PII &amp; gov IDs safe</span>
        <span class="fillai-field-pill" data-status>${escapeHtml(status || `${detectFields().length} fields`)}</span>
      </div>
      ${renderSettings()}
    </section>
    <footer class="fillai-actions">
      ${activeVoice ? `
        <div class="fillai-recording-strip">
          <span class="fillai-rec-dot ${voiceListening ? "active" : ""}"></span>
          <span class="fillai-rec-label">${voiceListening ? "Listening — speak now" : "Starting microphone…"}</span>
          <button class="fillai-stop-btn" data-action="voice" type="button" aria-label="Stop recording">&#9632; Stop</button>
        </div>
      ` : `
        <div class="fillai-toolstrip">
          <button class="fillai-icon-button" data-action="voice" type="button" title="Speak to fill" aria-label="Speak to fill">${icon("mic")}</button>
          <button class="fillai-icon-button" data-action="clear" type="button" title="Clear" aria-label="Clear">${icon("trash")}</button>
        </div>
        <button class="fillai-button primary" data-action="generate" type="button">${icon("sparkles")} <span>Fill Form with AI</span></button>
      `}
    </footer>
  `;
  const textarea = panel.querySelector("textarea") as HTMLTextAreaElement;
  textarea.value = rawInput;
  textarea.addEventListener("input", () => {
    rawInput = textarea.value;
    scheduleDraftSave();
  });
  panel.querySelector('[data-action="close"]')?.addEventListener("click", () => panel?.remove());
  panel.querySelector('[data-action="generate"]')?.addEventListener("click", generateDraft);
  panel.querySelector('[data-action="voice"]')?.addEventListener("click", startDictation);
  panel.querySelector('[data-action="clear"]')?.addEventListener("click", clearText);
  panel.querySelector('[data-action="settings"]')?.addEventListener("click", toggleSettings);
  panel.querySelectorAll<HTMLInputElement>("[data-pref]").forEach((input) => {
    input.addEventListener("input", () => {
      preferences = readPreferencesFromPanel();
      void savePreferencesForContent(preferences);
    });
  });
  // Custom fields — add row
  panel.querySelector("#fillai-cf-add")?.addEventListener("click", () => {
    const list = panel?.querySelector("#fillai-cf-list");
    if (!list) return;
    const count = list.querySelectorAll(".fillai-cf-row").length;
    if (count >= 30) return;
    const row = document.createElement("div");
    row.className = "fillai-cf-row";
    row.dataset.cfIndex = String(count);
    row.innerHTML = `
      <input class="fillai-cf-label" placeholder="Field name (e.g. Employee ID)" />
      <input class="fillai-cf-value" placeholder="Value (e.g. EMP-12345)" />
      <button class="fillai-cf-remove" type="button" title="Remove" aria-label="Remove field">✕</button>
    `;
    list.append(row);
    wireCustomFieldRow(row);
    updateCustomFieldCount();
  });

  // Custom fields — existing rows
  panel.querySelectorAll<HTMLElement>(".fillai-cf-row").forEach(wireCustomFieldRow);
}

async function generateDraft() {
  if (!panel || !rawInput.trim()) {
    renderInput("Add text first, then generate a draft.");
    return;
  }

  setBusy("Generating local draft…");
  preferences = readPreferencesFromPanel();
  await Promise.all([savePopupDraftForContent(rawInput), savePreferencesForContent(preferences)]);
  const fields = detectFields();

  try {
    draft = await chrome.runtime.sendMessage({
      type: "FILLAI_INFER",
      payload: { rawInput, fields, preferences }
    }) as DraftResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Extension context invalidated") || msg.includes("message port closed")) {
      renderInput("Extension was updated — please reload this page and try again.");
    } else {
      renderInput("Something went wrong. Please try again.");
    }
    return;
  }

  const hasValues = draft.fields.some((f) => f.proposedValue.trim());
  if (!hasValues) {
    renderInput("No fields could be matched. Try adding more detail to your text.");
    return;
  }

  enterPreviewMode();
}

function isContextValid(): boolean {
  try { return Boolean(chrome.runtime?.id); } catch { return false; }
}

async function loadPreferencesForContent(): Promise<UserPreferences> {
  if (!isContextValid()) return CONTENT_DEFAULT_PREFERENCES;
  try {
    const result = await chrome.storage.local.get({ "fillai.preferences": CONTENT_DEFAULT_PREFERENCES });
    return { ...CONTENT_DEFAULT_PREFERENCES, ...result["fillai.preferences"] };
  } catch { return CONTENT_DEFAULT_PREFERENCES; }
}

async function savePreferencesForContent(nextPreferences: UserPreferences): Promise<void> {
  if (!isContextValid()) return;
  try { await chrome.storage.local.set({ "fillai.preferences": nextPreferences }); } catch { /* stale context */ }
}

async function loadPopupDraftForContent(): Promise<string> {
  if (!isContextValid()) return "";
  try {
    const result = await chrome.storage.local.get({ "fillai.popupDraft": "" });
    return result["fillai.popupDraft"] || "";
  } catch { return ""; }
}

async function savePopupDraftForContent(value: string): Promise<void> {
  if (!isContextValid()) return;
  try { await chrome.storage.local.set({ "fillai.popupDraft": value }); } catch { /* stale context */ }
}

// ── In-context preview mode ───────────────────────────────────────────

function enterPreviewMode() {
  if (!draft) return;

  // Close the FillAI panel — the form itself becomes the review UI.
  panel?.remove();
  panel = null;

  const { filled, needsReview } = previewFill(draft.fields);
  showApprovalBar(filled, needsReview);
}

function showApprovalBar(filled: number, needsReview: number) {
  approvalBar?.remove();
  approvalBar = document.createElement("div");
  approvalBar.id = "fillai-approval-bar";
  approvalBar.className = "fillai-approval-bar";

  const isHeuristic = draft?.engine === "heuristic";
  const engineNote = isHeuristic
    ? '<span class="fillai-bar-note">Quick match · review carefully</span>'
    : "";

  const countText = needsReview > 0
    ? `${filled} filled &nbsp;<span class="fillai-bar-sep">·</span>&nbsp; <span class="fillai-bar-attention">${icon("alert")} ${needsReview} need review</span>`
    : `<span class="fillai-bar-ok">${icon("check-circle")} ${filled} field${filled === 1 ? "" : "s"} filled</span>`;

  approvalBar.innerHTML = `
    <div class="fillai-bar-brand">
      ${icon("shield")}
      <span>FillAI</span>
    </div>
    <div class="fillai-bar-info">
      <span class="fillai-bar-count">${countText}</span>
      ${engineNote}
    </div>
    <div class="fillai-bar-actions">
      <button class="fillai-bar-btn fillai-bar-ghost" data-action="revert" type="button" aria-label="Revert and edit text">
        ${icon("edit")} <span>Edit text</span>
      </button>
      <button class="fillai-bar-btn fillai-bar-approve" data-action="approve" type="button" aria-label="Approve all filled values">
        ${icon("check")} <span>Approve all</span>
      </button>
    </div>
  `;

  approvalBar.querySelector('[data-action="approve"]')?.addEventListener("click", exitPreviewApprove);
  approvalBar.querySelector('[data-action="revert"]')?.addEventListener("click", exitPreviewRevert);

  document.documentElement.append(approvalBar);
}

function exitPreviewApprove() {
  const count = draft?.fields.filter((f) => f.proposedValue.trim()).length ?? 0;
  clearPreviewMarkers();
  approvalBar?.remove();
  approvalBar = null;
  draft = null;
  showToast(`${count} field${count === 1 ? "" : "s"} filled.`);
}

function exitPreviewRevert() {
  revertPreview();
  approvalBar?.remove();
  approvalBar = null;
  void openPanel();
}

function startDictation() {
  if (activeVoice) {
    window.postMessage({ source: "fillai-content", type: "FILLAI_STOP_VOICE" }, "*");
    activeVoice = false;
    voiceListening = false;
    voiceWaitingForBridge = false;
    window.clearTimeout(voiceStartTimer);
    renderInput(voiceHadTranscript ? "Voice saved." : "Ready.");
    return;
  }

  dictationBase = rawInput.replace(/\s+/g, " ").trim();
  activeVoice = true;
  voiceListening = false;
  voiceStarted = false;
  voiceHadTranscript = false;
  ensureVoiceBridge();
  renderInput("Starting microphone...");

  if (voiceBridgeReady) {
    postStartVoice();
  } else {
    // Bridge script is still loading — postStartVoice() will fire from the READY handler.
    voiceWaitingForBridge = true;
  }

  window.clearTimeout(voiceStartTimer);
  voiceStartTimer = window.setTimeout(() => {
    if (!activeVoice) return;
    activeVoice = false;
    voiceListening = false;
    voiceWaitingForBridge = false;
    renderInput("Voice did not start. Reload this page, allow microphone access, then try again.");
  }, 5000);
}

function applyVoiceText(text: string, status: string) {
  const transcript = text.replace(/\s+/g, " ").trim();
  rawInput = `${dictationBase} ${transcript}`.replace(/\s+/g, " ").trim();
  const textarea = panel?.querySelector("textarea") as HTMLTextAreaElement | null;
  if (textarea) textarea.value = rawInput;
  updateStatus(transcript ? `${status} Heard: ${transcript}` : status);
  scheduleDraftSave();
}

function updateStatus(message: string) {
  const status = panel?.querySelector("[data-status]");
  if (status) status.textContent = message;
}

function voiceErrorMessage(error?: string) {
  if (error === "not-allowed" || error === "service-not-allowed") return "Microphone blocked. Allow microphone access for this page, then try again.";
  if (error === "no-speech") return "No speech heard. Try again and speak after the mic turns red.";
  if (error === "audio-capture") return "No microphone found. Check your input device.";
  if (error === "network") return "Chrome speech recognition needs network access for this browser feature.";
  return `Voice input failed${error ? `: ${error}` : ""}.`;
}

function ensureVoiceBridge() {
  if (!document.getElementById("fillai-voice-bridge")) {
    const script = document.createElement("script");
    script.id = "fillai-voice-bridge";
    script.src = chrome.runtime.getURL("pageVoiceBridge.js");
    document.documentElement.append(script);
  }

  if (!window.__fillaiVoiceListener) {
    window.__fillaiVoiceListener = true;
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.data?.source !== "fillai-page") return;

      if (event.data.type === "FILLAI_VOICE_READY") {
        voiceBridgeReady = true;
        if (voiceWaitingForBridge) {
          voiceWaitingForBridge = false;
          postStartVoice();
        }
        return;
      }

      if (event.data.type === "FILLAI_VOICE_START") {
        window.clearTimeout(voiceStartTimer);
        voiceStarted = true;
        voiceListening = true;
        activeVoice = true;
        // Re-render to apply the pulse class to the mic button.
        renderInput("Listening... speak now.");
        return;
      }

      if (event.data.type === "FILLAI_VOICE_RESULT") {
        const text = String(event.data.text || "");
        voiceHadTranscript = Boolean(text.trim());
        applyVoiceText(text, text ? "Listening..." : "Listening... speak now.");
        return;
      }

      if (event.data.type === "FILLAI_VOICE_ERROR") {
        window.clearTimeout(voiceStartTimer);
        activeVoice = false;
        voiceListening = false;
        voiceStarted = false;
        renderInput(voiceErrorMessage(String(event.data.message || "")));
        return;
      }

      if (event.data.type === "FILLAI_VOICE_END") {
        window.clearTimeout(voiceStartTimer);
        activeVoice = false;
        voiceListening = false;
        voiceStarted = false;
        if (voiceHadTranscript || event.data.heardSpeech) {
          renderInput(rawInput ? "Voice saved." : "Ready.");
        } else {
          renderInput("Listening stopped before any speech was heard. Click the mic and speak after it turns red.");
        }
      }
    });
  }
}

function postStartVoice() {
  window.postMessage({ source: "fillai-content", type: "FILLAI_START_VOICE", lang: navigator.language || "en-US" }, "*");
}

function clearText() {
  rawInput = "";
  void savePopupDraftForContent("");
  renderInput("Cleared.");
}

function scheduleDraftSave() {
  window.clearTimeout(saveDraftTimer);
  saveDraftTimer = window.setTimeout(() => {
    void savePopupDraftForContent(rawInput);
  }, 250);
}

function wireCustomFieldRow(row: HTMLElement) {
  row.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      preferences = readPreferencesFromPanel();
      void savePreferencesForContent(preferences);
    });
  });
  row.querySelector(".fillai-cf-remove")?.addEventListener("click", () => {
    row.remove();
    preferences = readPreferencesFromPanel();
    void savePreferencesForContent(preferences);
    updateCustomFieldCount();
  });
}

function updateCustomFieldCount() {
  const list = panel?.querySelector("#fillai-cf-list");
  const count = list?.querySelectorAll(".fillai-cf-row").length ?? 0;
  const countEl = panel?.querySelector(".fillai-cf-count");
  if (countEl) countEl.textContent = `(${count}/30)`;
  const addBtn = panel?.querySelector<HTMLButtonElement>("#fillai-cf-add");
  if (addBtn) addBtn.disabled = count >= 30;
}

function toggleSettings() {
  panel?.querySelector(".fillai-settings")?.toggleAttribute("hidden");
}

function renderSettings() {
  const customRows = (preferences.customFields.length ? preferences.customFields : [{ label: "", value: "" }])
    .map((cf, i) => `
      <div class="fillai-cf-row" data-cf-index="${i}">
        <input class="fillai-cf-label" placeholder="Field name (e.g. Employee ID)" value="${escapeAttribute(cf.label)}" />
        <input class="fillai-cf-value" placeholder="Value (e.g. EMP-12345)" value="${escapeAttribute(cf.value)}" />
        <button class="fillai-cf-remove" type="button" title="Remove" aria-label="Remove field">✕</button>
      </div>
    `).join("");

  return `
    <div class="fillai-settings" hidden>
      <div class="fillai-settings-section">
        <strong class="fillai-settings-heading">Your defaults</strong>
        <p class="fillai-settings-hint">Saved once, reused on every form. Stored only on this device.</p>
        <div class="fillai-profile-grid">
          <input data-pref="name" placeholder="Full name" value="${escapeAttribute(preferences.commonProfile.name || "")}" />
          <input data-pref="email" placeholder="Email" value="${escapeAttribute(preferences.commonProfile.email || "")}" />
          <input data-pref="phone" placeholder="Phone" value="${escapeAttribute(preferences.commonProfile.phone || "")}" />
          <input data-pref="address" placeholder="Address" value="${escapeAttribute(preferences.commonProfile.address || "")}" />
        </div>
      </div>
      <div class="fillai-settings-section">
        <strong class="fillai-settings-heading">Custom fields <span class="fillai-cf-count">(${preferences.customFields.length}/30)</span></strong>
        <p class="fillai-settings-hint">Add anything else FillAI should know — employee ID, membership number, department, etc. FillAI matches these to form fields automatically.</p>
        <div class="fillai-cf-list" id="fillai-cf-list">
          ${customRows}
        </div>
        <button class="fillai-cf-add" type="button" id="fillai-cf-add" ${preferences.customFields.length >= 30 ? "disabled" : ""}>+ Add field</button>
      </div>
      <details class="fillai-advanced">
        <summary>AI engine</summary>
        <div class="fillai-settings-section">
          <strong class="fillai-settings-heading">Smart matching (active)</strong>
          <p class="fillai-settings-hint">Fields are filled using on-device pattern recognition — instant and private. No model download needed.</p>
          <p class="fillai-settings-hint" style="margin-top:6px;color:#6b7280;">Enhanced AI models (for complex unstructured text) are coming in a future update.</p>
        </div>
      </details>
      <div class="fillai-donate">
        <span>FillAI is free.</span>
        <a href="${DONATION_URL}" target="_blank" rel="noopener noreferrer">Support development</a>
      </div>
    </div>
  `;
}

function readPreferencesFromPanel(): UserPreferences {
  const getValue = (name: string) =>
    (panel?.querySelector(`[data-pref="${name}"]`) as HTMLInputElement | null)?.value.trim() || "";

  const customFields: { label: string; value: string }[] = [];
  panel?.querySelectorAll<HTMLElement>(".fillai-cf-row").forEach((row) => {
    const label = (row.querySelector(".fillai-cf-label") as HTMLInputElement | null)?.value.trim() || "";
    const value = (row.querySelector(".fillai-cf-value") as HTMLInputElement | null)?.value.trim() || "";
    if (label || value) customFields.push({ label, value });
  });

  return {
    ...preferences,
    modelId: preferences.modelId,
    preferWebGpu: preferences.preferWebGpu,
    commonProfile: {
      ...preferences.commonProfile,
      name: getValue("name"),
      email: getValue("email"),
      phone: getValue("phone"),
      address: getValue("address")
    },
    customFields
  };
}

function setBusy(message: string) {
  if (!panel) return;
  panel.querySelectorAll("button").forEach((button) => ((button as HTMLButtonElement).disabled = true));
  const status = panel.querySelector("[data-status]");
  if (status) status.textContent = message;
}

function showStaleContextBanner() {
  const existing = document.getElementById("fillai-stale-banner");
  if (existing) return;
  ensureStyles();
  const banner = document.createElement("div");
  banner.id = "fillai-stale-banner";
  banner.className = "fillai-stale-banner";
  banner.innerHTML = `FillAI was updated — <a href="" onclick="location.reload();return false;">reload this page</a> to continue.`;
  document.documentElement.append(banner);
}

function showToast(message: string) {
  const toast = document.createElement("div");
  toast.className = "fillai-fab";
  toast.textContent = message;
  toast.style.bottom = "78px";
  document.documentElement.append(toast);
  setTimeout(() => toast.remove(), 2200);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function statusTextForDraft(result: DraftResult) {
  if (result.engine === "heuristic") {
    return "Using quick local matching because AI model assets are not available yet. Review before filling.";
  }

  if (result.engine === "transformers") {
    return "Using local fallback AI. Review the values, edit anything that looks off, then approve.";
  }

  return "Using local AI. Review the values, edit anything that looks off, then approve.";
}

function confidenceClass(confidence: number) {
  if (confidence >= 0.75) return "confidence-high";
  if (confidence >= 0.45) return "confidence-medium";
  return "confidence-low";
}

function confidenceTitle(confidence: number) {
  if (confidence >= 0.75) return "High confidence";
  if (confidence >= 0.45) return "Medium confidence";
  return "Low confidence";
}

function icon(name: "mic" | "trash" | "settings" | "close" | "sparkles" | "edit" | "refresh" | "check" | "lock" | "shield" | "alert" | "check-circle") {
  const attrs = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const paths = {
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
    settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.1 2.1-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V20h-3v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2.1-2.1.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-1H3v-3h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.1-2.1.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V4h3v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.1 2.1-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v3h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h4"/><path d="M6 22v-4H2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    "check-circle": '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
  };
  return `<svg ${attrs}>${paths[name]}</svg>`;
}

function brandMark() {
  return `
    <span class="fillai-logo-mark" aria-hidden="true">
      <svg viewBox="0 0 128 128" fill="none">
        <rect width="128" height="128" rx="28" fill="url(#fillai-logo-bg)"/>
        <path d="M34 38h42c9 0 16 7 16 16v4H34V38Z" fill="#fff"/>
        <path d="M34 68h46c8 0 15 6 16 14H34V68Z" fill="#E0F2FE"/>
        <path d="M34 92h28c8 0 14 6 14 14H34V92Z" fill="#fff"/>
        <path d="m79 86 10 10 23-28" stroke="url(#fillai-logo-accent)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M92 25 96 36l11 4-11 4-4 11-4-11-11-4 11-4 4-11Z" fill="#A7F3D0"/>
        <defs>
          <linearGradient id="fillai-logo-bg" x1="20" y1="12" x2="108" y2="116" gradientUnits="userSpaceOnUse">
            <stop stop-color="#0C4A8A"/>
            <stop offset="1" stop-color="#0F766E"/>
          </linearGradient>
          <linearGradient id="fillai-logo-accent" x1="79" y1="68" x2="112" y2="96" gradientUnits="userSpaceOnUse">
            <stop stop-color="#7DD3FC"/>
            <stop offset="1" stop-color="#A7F3D0"/>
          </linearGradient>
        </defs>
      </svg>
    </span>
  `;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    __fillaiVoiceListener?: boolean;
  }
}

interface SpeechRecognitionConstructor {
  new(): SpeechRecognitionLike;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang?: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend?: (() => void) | null;
  start(): void;
  stop?: () => void;
}

interface SpeechRecognitionEventLike {
  resultIndex?: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
}
