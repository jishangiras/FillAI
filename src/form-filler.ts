import { DraftField } from "./shared/types";
import { elementForUid } from "./form-detector";

// Original values stored before a preview fill so we can revert.
const previewOriginals = new Map<string, string>();

// ── Public API ────────────────────────────────────────────────────────

export function fillFields(fields: DraftField[]): { filled: number; skipped: string[] } {
  const skipped: string[] = [];
  let filled = 0;
  for (const field of fields) {
    const element = elementForUid(field.uid);
    if (!element || field.proposedValue.trim() === "") {
      skipped.push(field.label || field.uid);
      continue;
    }
    setControlValue(element, field.proposedValue);
    filled += 1;
  }
  return { filled, skipped };
}

/** Fill fields with proposed values and apply coloured confidence rings.
 *  Stores originals so revertPreview() can restore them. */
export function previewFill(fields: DraftField[]): { filled: number; needsReview: number } {
  previewOriginals.clear();
  let filled = 0;
  let needsReview = 0;

  for (const field of fields) {
    if (!field.proposedValue.trim()) continue;
    const element = elementForUid(field.uid);
    if (!element) continue;

    previewOriginals.set(field.uid, element.value);
    setControlValue(element, field.proposedValue);

    const ring =
      field.confidence >= 0.75 ? "fillai-ring-high"
      : field.confidence >= 0.45 ? "fillai-ring-medium"
      : "fillai-ring-low";

    element.classList.add("fillai-preview-field", ring);
    (element as HTMLElement).dataset.fillaiPreview = "1";

    filled++;
    if (field.confidence < 0.45) needsReview++;
  }

  return { filled, needsReview };
}

/** Remove the confidence rings but keep the filled values — call on approve. */
export function clearPreviewMarkers(): void {
  for (const uid of previewOriginals.keys()) {
    const el = elementForUid(uid);
    if (!el) continue;
    el.classList.remove("fillai-preview-field", "fillai-ring-high", "fillai-ring-medium", "fillai-ring-low");
    delete (el as HTMLElement).dataset.fillaiPreview;
  }
  previewOriginals.clear();
}

/** Restore original values and remove rings — call on revert. */
export function revertPreview(): void {
  for (const [uid, original] of previewOriginals) {
    const el = elementForUid(uid);
    if (!el) continue;
    el.value = original;
    el.classList.remove("fillai-preview-field", "fillai-ring-high", "fillai-ring-medium", "fillai-ring-low");
    delete (el as HTMLElement).dataset.fillaiPreview;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  previewOriginals.clear();
}

// ── Internal ──────────────────────────────────────────────────────────

function setControlValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
) {
  if (element instanceof HTMLSelectElement) {
    const norm = value.trim().toLowerCase();
    const option = Array.from(element.options).find(
      (o) => o.value.toLowerCase() === norm || (o.textContent || "").trim().toLowerCase() === norm
    );
    element.value = option?.value ?? value;
  } else if (
    element instanceof HTMLInputElement &&
    (element.type === "checkbox" || element.type === "radio")
  ) {
    element.checked = ["true", "yes", "checked", "1", "on"].includes(value.trim().toLowerCase());
  } else {
    element.value = value;
  }

  element.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: value })
  );
  element.dispatchEvent(new Event("change", { bubbles: true }));
}
