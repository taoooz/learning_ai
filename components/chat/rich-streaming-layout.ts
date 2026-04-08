import type { ContentBlock } from '@/app/generate/chat/utils/contentParser';

type RichStreamingLayoutStateInput = {
  blocks: ContentBlock[];
  content: string;
  thinkingContent?: string;
};

export function getRichStreamingLayoutState({
  blocks,
  content,
  thinkingContent,
}: RichStreamingLayoutStateInput) {
  const hasStructuredPrimaryContent = blocks.some((block) => block.type !== 'text');
  const hasTextPrimaryContent = blocks.some(
    (block) => block.type === 'text' && block.content.trim().length > 0,
  );
  const hasFallbackPrimaryContent = !hasStructuredPrimaryContent && !hasTextPrimaryContent && content.trim().length > 0;
  const hasPrimaryContent = hasStructuredPrimaryContent || hasTextPrimaryContent || hasFallbackPrimaryContent;
  const hasThinkingContent = Boolean(thinkingContent?.trim());

  return {
    hasThinkingContent,
    hasStructuredPrimaryContent,
    hasTextPrimaryContent,
    hasFallbackPrimaryContent,
    hasPrimaryContent,
  };
}
