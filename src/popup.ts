import "./popup.css";
import { extension } from "./shared/browser";
import { loadPopupDraft, loadPreferences, savePopupDraft, savePreferences } from "./shared/storage";

const rawInput = document.querySelector<HTMLTextAreaElement>("#rawInput")!;
const modelId = document.querySelector<HTMLInputElement>("#modelId")!;
const preferWebGpu = document.querySelector<HTMLInputElement>("#preferWebGpu")!;
const status = document.querySelector<HTMLElement>("#status")!;
const profileName = document.querySelector<HTMLInputElement>("#profileName")!;
const profileEmail = document.querySelector<HTMLInputElement>("#profileEmail")!;
const profilePhone = document.querySelector<HTMLInputElement>("#profilePhone")!;
const profileAddress = document.querySelector<HTMLInputElement>("#profileAddress")!;
const speakInput = document.querySelector<HTMLButtonElement>("#speakInput")!;
const clearInput = document.querySelector<HTMLButtonElement>("#clearInput")!;
let saveDraftTimer = 0;
let recognition: SpeechRecognitionLike | null = null;
let dictationBase = "";

void init();

async function init() {
  const [preferences, draft] = await Promise.all([loadPreferences(), loadPopupDraft()]);
  rawInput.value = draft;
  modelId.value = preferences.modelId;
  preferWebGpu.checked = preferences.preferWebGpu;
  profileName.value = preferences.commonProfile.name || "";
  profileEmail.value = preferences.commonProfile.email || "";
  profilePhone.value = preferences.commonProfile.phone || "";
  profileAddress.value = preferences.commonProfile.address || "";
}

rawInput.addEventListener("input", () => {
  window.clearTimeout(saveDraftTimer);
  saveDraftTimer = window.setTimeout(() => {
    void savePopupDraft(rawInput.value);
    setStatus("Saved draft");
  }, 250);
});

document.querySelector("#openPanel")?.addEventListener("click", async () => {
  setStatus("Opening page review...");
  await savePopupDraft(rawInput.value);
  await saveCurrentPreferences();
  const tab = await extension.queryActiveTab();
  if (!tab?.id) {
    setStatus("No active tab found");
    return;
  }
  try {
    await openPanelInTab(tab.id);
    window.close();
  } catch {
    setStatus("Enable file access or use an http page");
  }
});

document.querySelector("#savePrefs")?.addEventListener("click", async () => {
  await savePopupDraft(rawInput.value);
  await saveCurrentPreferences();
  setStatus("Saved");
});

speakInput.addEventListener("click", () => {
  if (recognition) {
    recognition.stop?.();
    stopListening("Stopped");
    return;
  }
  startDictation();
});

clearInput.addEventListener("click", async () => {
  rawInput.value = "";
  await savePopupDraft("");
  setStatus("Cleared");
});

async function saveCurrentPreferences() {
  const current = await loadPreferences();
  await savePreferences({
    ...current,
    modelId: modelId.value.trim() || current.modelId,
    preferWebGpu: preferWebGpu.checked,
    commonProfile: {
      ...current.commonProfile,
      name: profileName.value.trim(),
      email: profileEmail.value.trim(),
      phone: profilePhone.value.trim(),
      address: profileAddress.value.trim()
    }
  });
}

function setStatus(message: string) {
  status.textContent = message;
}

async function openPanelInTab(tabId: number) {
  const message = { type: "FILLAI_OPEN_PANEL", rawInput: rawInput.value };
  try {
    await extension.sendTabMessage(tabId, message);
    return;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    await extension.sendTabMessage(tabId, message);
  }
}

function startDictation() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus("Voice input is not available here");
    return;
  }

  const activeRecognition = new SpeechRecognition();
  recognition = activeRecognition;
  dictationBase = rawInput.value.replace(/\s+/g, " ").trim();
  activeRecognition.continuous = true;
  activeRecognition.interimResults = true;
  activeRecognition.lang = navigator.language || "en-US";
  speakInput.textContent = "Stop";
  speakInput.classList.add("listening");
  setStatus("Listening...");

  let committedTranscript = "";
  activeRecognition.onresult = (event: SpeechRecognitionEventLike) => {
    let interimTranscript = "";
    for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0]?.transcript || "";
      if (result.isFinal) {
        committedTranscript += ` ${transcript}`;
      } else {
        interimTranscript += ` ${transcript}`;
      }
    }

    const addition = `${committedTranscript} ${interimTranscript}`.replace(/\s+/g, " ").trim();
    if (addition) {
      rawInput.value = `${dictationBase} ${addition}`.replace(/\s+/g, " ").trim();
      void savePopupDraft(rawInput.value);
    }
  };
  activeRecognition.onerror = () => stopListening("Voice input failed");
  activeRecognition.onend = () => stopListening(rawInput.value ? "Voice saved" : "Ready");
  activeRecognition.start();
}

function stopListening(message: string) {
  recognition = null;
  speakInput.textContent = "Speak";
  speakInput.classList.remove("listening");
  setStatus(message);
}
