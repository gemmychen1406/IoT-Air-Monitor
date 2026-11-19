import type { SavedConfiguration } from "./types.js";

const PREFIX = "airguard.comparison-reporting.v1";
const key = (userId: string) => `${PREFIX}.${userId}`;

export function loadConfigurations(userId: string): SavedConfiguration[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(key(userId)) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedConfiguration =>
        !!item &&
        typeof item === "object" &&
        typeof (item as SavedConfiguration).id === "string" &&
        typeof (item as SavedConfiguration).name === "string",
    );
  } catch {
    return [];
  }
}

export function saveConfigurations(
  userId: string,
  values: SavedConfiguration[],
) {
  localStorage.setItem(key(userId), JSON.stringify(values));
}
