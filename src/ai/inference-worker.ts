import { runInference } from "./ai-core";
import { InferenceRequest } from "../shared/types";

self.onmessage = async (event: MessageEvent<{ id: string; request: InferenceRequest }>) => {
  try {
    const result = await runInference(event.data.request, (message) => {
      self.postMessage({ id: event.data.id, type: "progress", message });
    });
    self.postMessage({ id: event.data.id, type: "result", result });
  } catch (error) {
    self.postMessage({ id: event.data.id, type: "error", error: error instanceof Error ? error.message : String(error) });
  }
};
