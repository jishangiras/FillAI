type FillAIVoiceMessage =
  | { source: "fillai-content"; type: "FILLAI_START_VOICE"; lang?: string }
  | { source: "fillai-content"; type: "FILLAI_STOP_VOICE" };

export {};

type FillAISpeechRecognitionConstructor = new () => FillAISpeechRecognition;

interface FillAISpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: FillAISpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface FillAISpeechRecognitionEvent {
  resultIndex?: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
}

declare global {
  interface Window {
    __fillaiVoiceBridge?: boolean;
  }
}

if (!window.__fillaiVoiceBridge) {
  window.__fillaiVoiceBridge = true;

  let recognition: FillAISpeechRecognition | null = null;
  let committed = "";
  let heardSpeech = false;
  let restartCount = 0;
  const MAX_RESTARTS = 8;

  window.postMessage({ source: "fillai-page", type: "FILLAI_VOICE_READY" }, "*");

  window.addEventListener("message", (event: MessageEvent<FillAIVoiceMessage>) => {
    if (event.source !== window || event.data?.source !== "fillai-content") return;

    if (event.data.type === "FILLAI_STOP_VOICE") {
      // Null first so onend sees recognition !== nextRecognition and exits early.
      const current = recognition;
      recognition = null;
      current?.stop();
      window.postMessage({ source: "fillai-page", type: "FILLAI_VOICE_END", heardSpeech }, "*");
      return;
    }

    if (event.data.type !== "FILLAI_START_VOICE") return;
    const startMessage = event.data;

    const SpeechRecognition = (window.SpeechRecognition || window.webkitSpeechRecognition) as FillAISpeechRecognitionConstructor | undefined;
    if (!SpeechRecognition) {
      window.postMessage({ source: "fillai-page", type: "FILLAI_VOICE_ERROR", message: "unsupported" }, "*");
      return;
    }

    // Stop any prior session without posting VOICE_END.
    const prev = recognition;
    recognition = null;
    prev?.stop();

    committed = "";
    heardSpeech = false;
    restartCount = 0;

    const startRecognition = () => {
      const nextRecognition = new SpeechRecognition();
      recognition = nextRecognition;

      nextRecognition.continuous = true;
      nextRecognition.interimResults = true;
      nextRecognition.lang = startMessage.lang || navigator.language || "en-US";

      nextRecognition.onstart = () => {
        window.postMessage({ source: "fillai-page", type: "FILLAI_VOICE_START" }, "*");
      };

      nextRecognition.onresult = (speechEvent) => {
        let interim = "";
        for (let i = speechEvent.resultIndex || 0; i < speechEvent.results.length; i++) {
          const result = speechEvent.results[i];
          const transcript = result[0]?.transcript || "";
          if (result.isFinal) committed += ` ${transcript}`;
          else interim += ` ${transcript}`;
        }
        const text = `${committed} ${interim}`.replace(/\s+/g, " ").trim();
        heardSpeech = heardSpeech || text.length > 0;
        window.postMessage({ source: "fillai-page", type: "FILLAI_VOICE_RESULT", text }, "*");
      };

      nextRecognition.onerror = (errorEvent) => {
        const err = errorEvent.error || "unknown";

        // no-speech is a normal Chrome timeout after ~7 s of silence — restart silently.
        if (err === "no-speech" && restartCount < MAX_RESTARTS && recognition === nextRecognition) {
          restartCount++;
          // onend will fire next; the onend handler sees restartCount > 0 and restarts.
          return;
        }

        // Terminal error: detach from this recognition instance so onend is ignored,
        // then surface the error to the UI.
        recognition = null;
        window.postMessage({ source: "fillai-page", type: "FILLAI_VOICE_ERROR", message: err }, "*");
      };

      nextRecognition.onend = () => {
        // Either stopped externally (FILLAI_STOP_VOICE nulled recognition before calling .stop())
        // or a terminal onerror nulled it — either way, bail out without posting VOICE_END.
        if (recognition !== nextRecognition) return;

        recognition = null;

        // Restart for two reasons:
        // 1. no-speech timeout  (restartCount was incremented by onerror)
        // 2. Chrome silently ended the session with no error  (also restart, up to MAX_RESTARTS)
        if (restartCount < MAX_RESTARTS) {
          restartCount++;
          // Brief delay avoids a tight loop if there is a systematic issue.
          window.setTimeout(startRecognition, 150);
          return;
        }

        window.postMessage({ source: "fillai-page", type: "FILLAI_VOICE_END", heardSpeech }, "*");
      };

      try {
        nextRecognition.start();
      } catch (error) {
        recognition = null;
        window.postMessage({
          source: "fillai-page",
          type: "FILLAI_VOICE_ERROR",
          message: error instanceof Error ? error.message : "unknown"
        }, "*");
      }
    };

    startRecognition();
  });
}
