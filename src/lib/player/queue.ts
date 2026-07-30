import type { QueueItem } from "./types";

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function currentQueueItemId(
  queue: readonly QueueItem[],
  currentIndex: number,
): string | null {
  return queue[currentIndex]?.queueItemId ?? null;
}

export function findQueueIndex(
  queue: readonly QueueItem[],
  queueItemId: string | null,
): number {
  if (!queueItemId) {
    return -1;
  }

  return queue.findIndex((item) => item.queueItemId === queueItemId);
}

export function createShuffleBag(
  queue: readonly QueueItem[],
  currentId: string | null,
  random: () => number,
): string[] {
  const bag = queue
    .map((item) => item.queueItemId)
    .filter((queueItemId) => queueItemId !== currentId);

  for (let index = bag.length - 1; index > 0; index -= 1) {
    const target = Math.floor(clamp(random(), 0, 0.999999999) * (index + 1));
    [bag[index], bag[target]] = [bag[target], bag[index]];
  }

  return bag;
}

export function removeQueueItemReferences(
  references: readonly string[],
  queueItemId: string,
): string[] {
  return references.filter((reference) => reference !== queueItemId);
}
