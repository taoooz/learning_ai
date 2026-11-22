type LearnerPositioningPreview = {
  estimatedLevel?: string;
  backgroundSummary?: string;
  skipBasics?: string[];
  likelyGaps?: string[];
  preferredExampleDomains?: string[];
};

export function shouldRenderLearnerPositioningCard({
  estimatedLevel,
  backgroundSummary,
  skipBasics,
  likelyGaps,
  preferredExampleDomains,
}: LearnerPositioningPreview): boolean {
  const hasNonDefaultLevel = Boolean(estimatedLevel && estimatedLevel !== 'beginner');
  const hasBackgroundSummary = Boolean(backgroundSummary?.trim());
  const hasSkipBasics = Boolean(skipBasics?.length);
  const hasLikelyGaps = Boolean(likelyGaps?.length);
  const hasExamplePolicy = Boolean(preferredExampleDomains?.length);

  return hasNonDefaultLevel || hasBackgroundSummary || hasSkipBasics || hasLikelyGaps || hasExamplePolicy;
}
