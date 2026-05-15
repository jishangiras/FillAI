import { DraftResult, InferenceRequest } from "../shared/types";
import { buildExtractionPrompt } from "./prompt";
import { heuristicDraft } from "./heuristic";

type ParsedModelField = { uid: string; value: string; confidence?: number; reason?: string };

// Models (WebLLM / Transformers.js) require 250–800 MB first-run downloads and
// are blocked by extension CSP script-src in many contexts. The heuristic engine
// uses entity extraction + autocomplete-attribute mapping and is instant.
// Heavy models are kept for future opt-in (e.g. a "Download AI model" toggle).

export async function runInference(request: InferenceRequest, progress?: (message: string) => void): Promise<DraftResult> {
  const started = performance.now();
  progress?.("Filling with smart matching");
  return result(
    heuristicDraft(request.rawInput, request.fields, request.preferences.commonProfile, request.preferences.customFields ?? []),
    "heuristic",
    [],
    started
  );
}

async function runWebLlm(request: InferenceRequest) {
  if (request.preferences.preferWebGpu && !("gpu" in navigator)) {
    throw new Error("WebGPU is not supported in this browser");
  }

  const webllm = await import("@mlc-ai/web-llm");
  const engine = await webllm.CreateMLCEngine(request.preferences.modelId, {
    initProgressCallback: () => undefined
  });
  const completion = await engine.chat.completions.create({
    messages: [
      { role: "system", content: "Return strict JSON. No markdown." },
      { role: "user", content: buildExtractionPrompt(request.rawInput, request.fields, request.preferences.commonProfile, request.preferences.customFields ?? []) }
    ],
    temperature: 0.1,
    max_tokens: 800
  });

  return normalizeFields(parseModelJson(completion.choices[0]?.message?.content || ""), request);
}

async function runTransformers(request: InferenceRequest) {
  const transformers = await import("@huggingface/transformers");
  // Flan-T5-base (~250 MB) strikes the best size/quality balance for instruction following.
  const generator = await transformers.pipeline("text2text-generation", "Xenova/flan-t5-base", {
    device: "webgpu" in navigator ? "webgpu" : "wasm"
  } as Record<string, unknown>);
  const output = await generator(buildExtractionPrompt(request.rawInput, request.fields, request.preferences.commonProfile, request.preferences.customFields ?? []), {
    max_new_tokens: 600,
    temperature: 0.05,
    repetition_penalty: 1.3
  } as Record<string, unknown>);
  const normalizedOutput = output as unknown as Array<{ generated_text?: string }> | { generated_text?: string };
  const text = Array.isArray(normalizedOutput) ? normalizedOutput[0]?.generated_text : normalizedOutput.generated_text;
  return normalizeFields(parseModelJson(String(text || "")), request);
}

function normalizeFields(modelFields: ParsedModelField[], request: InferenceRequest) {
  const fallback = heuristicDraft(request.rawInput, request.fields, request.preferences.commonProfile, request.preferences.customFields ?? []);
  return fallback.map((fallbackField) => {
    const modelField = modelFields.find((field) => field.uid === fallbackField.uid);
    if (!modelField) return fallbackField;
    return {
      uid: fallbackField.uid,
      label: fallbackField.label,
      proposedValue: String(modelField.value || ""),
      confidence: clamp(Number(modelField.confidence ?? 0.7), 0, 1),
      reason: String(modelField.reason || "Mapped by local model.")
    };
  });
}

function parseModelJson(text: string): ParsedModelField[] {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
  const parsed = JSON.parse(jsonText) as { fields?: ParsedModelField[] };
  return Array.isArray(parsed.fields) ? parsed.fields : [];
}

function result(fields: DraftResult["fields"], engine: DraftResult["engine"], warnings: string[], started: number): DraftResult {
  return {
    fields,
    engine,
    warnings,
    elapsedMs: Math.round(performance.now() - started)
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function userFacingModelWarning(engine: string, error: unknown) {
  const message = messageFrom(error).toLowerCase();
  if (message.includes("failed to fetch") || message.includes("network") || message.includes("load failed")) {
    return `${engine} model assets could not be loaded.`;
  }
  if (message.includes("webgpu")) {
    return `${engine} needs WebGPU support for the selected model.`;
  }
  return `${engine} is unavailable in this browser session.`;
}
