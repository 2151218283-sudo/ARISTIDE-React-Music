let pendingProfileAvatarTransitionId: string | null = null;

export function requestProfileAvatarTransition(userId: string): void {
  pendingProfileAvatarTransitionId = userId;
}

export function consumeProfileAvatarTransition(userId: string): boolean {
  if (pendingProfileAvatarTransitionId !== userId) {
    return false;
  }
  pendingProfileAvatarTransitionId = null;
  return true;
}
