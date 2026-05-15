import { runInference } from "./ai/ai-core";
import { extension } from "./shared/browser";
import { RuntimeMessage } from "./shared/types";

extension.onMessage(async (message) => {
  const runtimeMessage = message as RuntimeMessage;
  if (runtimeMessage.type !== "FILLAI_OFFSCREEN_INFER") return undefined;
  return runInference(runtimeMessage.payload);
});
