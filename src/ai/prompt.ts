import { CustomField, FieldMeta } from "../shared/types";

export function buildExtractionPrompt(rawInput: string, fields: FieldMeta[], profile: Record<string, string>, customFields: CustomField[] = []) {
  // Compact field list: only the signals a model needs to identify each field.
  const compactFields = fields.map((f) => ({
    uid: f.uid,
    label: f.label || f.ariaLabel || f.placeholder || f.name || f.id,
    type: f.type,
    autocomplete: f.autocomplete || undefined,
    options: f.options.length ? f.options.map((o) => o.label) : undefined,
  }));

  const filled = Object.fromEntries(Object.entries(profile).filter(([, v]) => v));
  const custom = customFields.filter((cf) => cf.label && cf.value);
  if (custom.length) custom.forEach((cf) => { filled[cf.label] = cf.value; });
  const profileHint = Object.keys(filled).length
    ? `Known profile data (use if helpful): ${JSON.stringify(filled)}\n`
    : "";

  // Compact, imperative prompt — works well with both large and small instruction-tuned models.
  return [
    "Extract form field values from the user text below.",
    "Return ONLY a JSON object — no explanation, no markdown, no extra text.",
    'Schema: {"fields":[{"uid":"<uid>","value":"<clean value>","confidence":<0.0–1.0>}]}',
    "Rules:",
    "- Use only information explicitly present in the user text or profile.",
    "- Never invent values. Use empty string and confidence 0.1 when unsure.",
    "- Clean up spelling/formatting (e.g. normalise phone numbers, capitalise names).",
    "- For select fields, return the exact option label listed.",
    "",
    profileHint + `Form fields: ${JSON.stringify(compactFields)}`,
    "",
    `User text: ${rawInput}`,
  ].join("\n");
}
