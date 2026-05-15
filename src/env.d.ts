declare const __FILLAI_BROWSER__: "chrome" | "firefox";

declare module "*.css?inline" {
  const css: string;
  export default css;
}

interface SpeechRecognitionConstructor {
  new(): SpeechRecognitionLike;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang?: string;
  onstart?: (() => void) | null;
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
