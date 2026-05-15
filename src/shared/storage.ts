import { DEFAULT_PREFERENCES, UserPreferences } from "./types";
import { extension } from "./browser";

const PREFERENCES_KEY = "fillai.preferences";
const POPUP_DRAFT_KEY = "fillai.popupDraft";

export async function loadPreferences(): Promise<UserPreferences> {
  const result = await extension.storage.get<Record<string, UserPreferences>>({ [PREFERENCES_KEY]: DEFAULT_PREFERENCES });
  return { ...DEFAULT_PREFERENCES, ...result[PREFERENCES_KEY] };
}

export async function savePreferences(preferences: UserPreferences): Promise<void> {
  await extension.storage.set({ [PREFERENCES_KEY]: preferences });
}

export async function loadPopupDraft(): Promise<string> {
  const result = await extension.storage.get<Record<string, string>>({ [POPUP_DRAFT_KEY]: "" });
  return result[POPUP_DRAFT_KEY] || "";
}

export async function savePopupDraft(value: string): Promise<void> {
  await extension.storage.set({ [POPUP_DRAFT_KEY]: value });
}
