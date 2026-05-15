import { runInference } from "./ai/ai-core";
import { extension } from "./shared/browser";
import { RuntimeMessage } from "./shared/types";

extension.onMessage(async (message) => {
  const runtimeMessage = message as RuntimeMessage;

  if (runtimeMessage.type === "FILLAI_INFER") {
    return infer(runtimeMessage);
  }

  if (runtimeMessage.type === "FILLAI_OPEN_PANEL") {
    const tab = await extension.queryActiveTab();
    if (!tab?.id) return { ok: false, error: "No active tab" };
    return extension.sendTabMessage(tab.id, runtimeMessage);
  }

  return undefined;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await openPanelOnTab(tab.id);
});

async function infer(message: Extract<RuntimeMessage, { type: "FILLAI_INFER" }>) {
  if (__FILLAI_BROWSER__ === "chrome" && Boolean(chrome.offscreen)) {
    try {
      await ensureOffscreenDocument();
      return await extension.sendMessage({ type: "FILLAI_OFFSCREEN_INFER", payload: message.payload });
    } catch {
      return runInference(message.payload);
    }
  }

  return runInference(message.payload);
}

async function openPanelOnTab(tabId: number) {
  const message: RuntimeMessage = { type: "FILLAI_OPEN_PANEL" };
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    await chrome.tabs.sendMessage(tabId, message);
  }
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl]
  });
  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Run local AI model inference without blocking extension UI."
  });
}
