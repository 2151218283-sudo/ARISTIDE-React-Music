const recentSearches = new Map<string, string[]>();
const listeners = new Set<() => void>();

export function searchScope(mode: "real" | "demo", userId: string | null): string {
  return `${mode}:${userId ?? "guest"}`;
}

export function getRecentSearches(scope: string): string[] {
  return [...(recentSearches.get(scope) ?? [])];
}

export function recordRecentSearch(scope: string, text: string): void {
  const normalized = text.trim();
  if (!normalized) return;
  const previous = recentSearches.get(scope) ?? [];
  recentSearches.set(scope, [normalized, ...previous.filter((item) => item !== normalized)].slice(0, 8));
  listeners.forEach((listener) => listener());
}

export function clearRecentSearches(scope: string): void {
  recentSearches.delete(scope);
  listeners.forEach((listener) => listener());
}

export function subscribeRecentSearches(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
