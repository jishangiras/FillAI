import { FieldMeta } from "./shared/types";

const CONTROL_SELECTOR = [
  "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset])",
  "textarea",
  "select"
].join(",");

export function detectFields(root: ParentNode = document): FieldMeta[] {
  const fields: FieldMeta[] = [];
  const seen = new WeakSet<Element>();

  function visit(node: ParentNode) {
    node.querySelectorAll(CONTROL_SELECTOR).forEach((element) => {
      if (seen.has(element) || !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return;
      seen.add(element);
      if (element.closest(".fillai-panel")) return;
      if (element.disabled || !isVisible(element)) return;
      fields.push(toFieldMeta(element, fields.length));
    });

    node.querySelectorAll("*").forEach((element) => {
      const shadow = (element as HTMLElement).shadowRoot;
      if (shadow) visit(shadow);
    });
  }

  visit(root);
  return fields;
}

export function elementForUid(uid: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  return document.querySelector(`[data-fillai-uid="${CSS.escape(uid)}"]`);
}

function toFieldMeta(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, index: number): FieldMeta {
  const uid = element.dataset.fillaiUid || `sf-${Date.now().toString(36)}-${index}`;
  element.dataset.fillaiUid = uid;

  return {
    uid,
    tagName: element.tagName.toLowerCase() as FieldMeta["tagName"],
    type: element instanceof HTMLInputElement ? element.type || "text" : element.tagName.toLowerCase(),
    label: findLabel(element),
    placeholder: "placeholder" in element ? element.placeholder : "",
    name: element.name || "",
    id: element.id || "",
    ariaLabel: element.getAttribute("aria-label") || "",
    autocomplete: element.getAttribute("autocomplete") || "",
    options: element instanceof HTMLSelectElement ? Array.from(element.options).map((option) => ({ value: option.value, label: option.textContent?.trim() || option.value })) : [],
    surroundingText: surroundingText(element),
    currentValue: element.value || "",
    required: element.required,
    disabled: element.disabled,
    readonly: "readOnly" in element ? element.readOnly : false
  };
}

function findLabel(element: HTMLElement): string {
  const labels = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
    ? Array.from(element.labels || []).map((label) => label.textContent?.trim()).filter(Boolean)
    : [];
  if (labels.length) return labels.join(" ");

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }

  const wrapperLabel = element.closest("label")?.textContent?.trim();
  if (wrapperLabel) return wrapperLabel;

  const parentText = element.parentElement?.textContent?.replace(/\s+/g, " ").trim();
  return parentText && parentText.length < 120 ? parentText : "";
}

function surroundingText(element: HTMLElement): string {
  const blocks = [element.closest("fieldset"), element.closest("section"), element.closest("form"), element.parentElement]
    .map((node) => node?.textContent?.replace(/\s+/g, " ").trim())
    .filter(Boolean) as string[];
  return blocks.find((text) => text.length > 0)?.slice(0, 500) || "";
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}
