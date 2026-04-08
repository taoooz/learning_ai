type ThinkingPresentationInput = {
  isThinking?: boolean;
  hasPrimaryContent: boolean;
  isExpanded: boolean;
};

export type ThinkingPresentationMode =
  | 'thinking-only'
  | 'thinking-active'
  | 'secondary-expanded'
  | 'secondary-collapsed';

export function getThinkingPresentationMode({
  isThinking,
  hasPrimaryContent,
  isExpanded,
}: ThinkingPresentationInput): ThinkingPresentationMode {
  if (isThinking && !hasPrimaryContent) {
    return 'thinking-only';
  }

  if (isThinking) {
    return 'thinking-active';
  }

  if (isExpanded) {
    return 'secondary-expanded';
  }

  return 'secondary-collapsed';
}
