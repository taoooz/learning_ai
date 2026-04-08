type LearnerPositioningPreview = {
  estimatedLevel?: string;
  difficultySummary?: string;
  backgroundSummary?: string;
  skipBasics?: string[];
  whyThisCourseFits?: string;
};

export function shouldRenderLearnerPositioningCard({
  estimatedLevel,
  difficultySummary,
  backgroundSummary,
  skipBasics,
  whyThisCourseFits,
}: LearnerPositioningPreview): boolean {
  const hasNonDefaultLevel = Boolean(estimatedLevel && estimatedLevel !== 'beginner');
  const hasDifficultySummary = Boolean(difficultySummary?.trim());
  const hasBackgroundSummary = Boolean(backgroundSummary?.trim());
  const hasSkipBasics = Boolean(skipBasics?.length);
  const hasWhyThisCourseFits = Boolean(whyThisCourseFits?.trim());

  return hasNonDefaultLevel || hasDifficultySummary || hasBackgroundSummary || hasSkipBasics || hasWhyThisCourseFits;
}
