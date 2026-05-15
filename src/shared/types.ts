export type BrowserTarget = "chrome" | "firefox";

export interface FieldMeta {
  uid: string;
  tagName: "input" | "textarea" | "select";
  type: string;
  label: string;
  placeholder: string;
  name: string;
  id: string;
  ariaLabel: string;
  autocomplete: string;
  options: Array<{ value: string; label: string }>;
  surroundingText: string;
  currentValue: string;
  required: boolean;
  disabled: boolean;
  readonly: boolean;
}

export interface DraftField {
  uid: string;
  label: string;
  proposedValue: string;
  confidence: number;
  reason: string;
}

export interface DraftResult {
  fields: DraftField[];
  engine: "webllm" | "transformers" | "heuristic";
  warnings: string[];
  elapsedMs: number;
}

export interface CustomField {
  label: string;
  value: string;
}

export interface UserPreferences {
  modelId: string;
  preferWebGpu: boolean;
  autoOpenOnForms: boolean;
  commonProfile: Record<string, string>;
  customFields: CustomField[];
}

export interface InferenceRequest {
  rawInput: string;
  fields: FieldMeta[];
  preferences: UserPreferences;
}

export type RuntimeMessage =
  | { type: "FILLAI_COLLECT_FIELDS" }
  | { type: "FILLAI_OPEN_PANEL"; rawInput?: string }
  | { type: "FILLAI_INFER"; payload: InferenceRequest }
  | { type: "FILLAI_OFFSCREEN_INFER"; payload: InferenceRequest }
  | { type: "FILLAI_FILL"; payload: { fields: DraftField[] } }
  | { type: "FILLAI_STATUS"; payload: { message: string; level?: "info" | "warning" | "error" } };

export const DEFAULT_PREFERENCES: UserPreferences = {
  modelId: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  preferWebGpu: true,
  autoOpenOnForms: true,
  commonProfile: {},
  customFields: []
};
