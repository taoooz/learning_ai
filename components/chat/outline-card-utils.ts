type LearnerPositioningPreview = {
  estimatedLevel?: string;
  backgroundSummary?: string;
  skipBasics?: string[];
};

export function shouldRenderLearnerPositioningCard({
  estimatedLevel,
  backgroundSummary,
  skipBasics,
}: LearnerPositioningPreview): boolean {
  const hasNonDefaultLevel = Boolean(estimatedLevel && estimatedLevel !== 'beginner');
  const hasBackgroundSummary = Boolean(backgroundSummary?.trim());
  const hasSkipBasics = Boolean(skipBasics?.length);

  return hasNonDefaultLevel || hasBackgroundSummary || hasSkipBasics;
}
