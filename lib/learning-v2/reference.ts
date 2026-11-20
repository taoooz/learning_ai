// lib/learning-v2/reference.ts
// 章节完成后的确定性参考物提取：不调用 LLM、不增加等待时间。

import type {
  CourseGlossaryTerm,
  CourseReference,
  LearningContentBlock,
  NodeLesson,
  SourceRef,
  StoredCourse,
} from '@/types/learning-v2';

const REFERENCE_BLOCK_TYPES = new Set(['key_point', 'comparison', 'diagram']);

function normalizeSourceRefs(refs: SourceRef[] | undefined): SourceRef[] {
  const seen = new Set<string>();
  const result: SourceRef[] = [];
  for (const ref of refs ?? []) {
    if (!ref?.url || seen.has(ref.url)) continue;
    seen.add(ref.url);
    result.push({ title: ref.title || ref.url, url: ref.url });
  }
  return result.slice(0, 8);
}

function mergeBlocks(current: LearningContentBlock[], incoming: LearningContentBlock[]): LearningContentBlock[] {
  const seen = new Set(current.map((block) => block.blockId));
  return [...current, ...incoming.filter((block) => !seen.has(block.blockId))];
}

const GENERIC_TERM_TITLES = new Set(['核心概念', '核心要点', '关键点', '模式总结', '启示']);

function normalizeTermTitle(raw: string): string {
  return raw
    .replace(/[*_`]/g, '')
    .replace(/^(核心概念|关键结论|模式总结|启示|要点)[：:]/, '')
    .trim();
}

function conciseTerm(raw: string): string {
  const normalized = normalizeTermTitle(raw);
  if (normalized.length <= 16) return normalized;
  const cut = normalized.search(/[，。：:、]/);
  return (cut > 0 ? normalized.slice(0, cut) : normalized.slice(0, 16)).trim();
}

function splitTermLine(raw: string): { term?: string; definition?: string } {
  const normalized = normalizeTermTitle(raw);
  const colonIndex = normalized.search(/[：:]/);
  if (colonIndex < 0) return {};

  const left = normalizeTermTitle(normalized.slice(0, colonIndex));
  const right = normalizeTermTitle(normalized.slice(colonIndex + 1));
  if (!left || !right) return {};

  // “关键结论：XXX” 里左侧是通用标签，右侧才是可压缩术语。
  if (GENERIC_TERM_TITLES.has(left)) {
    return { term: conciseTerm(right), definition: right };
  }
  return { term: left, definition: right };
}

function extractTermFromKeyPoint(points: string[]): { term?: string; definition?: string } {
  for (const point of points.slice(0, 3)) {
    const split = splitTermLine(point);
    if (split.term && split.term.length >= 2) return split;
  }
  return {};
}

function termIdFromTitle(title: string): string {
  const normalized = title.trim().replace(/\s+/g, '-').toLowerCase();
  return `term-${normalized || 'concept'}`;
}

export function buildChapterGlossary(lesson: NodeLesson, now: number): CourseGlossaryTerm[] {
  const terms = new Map<string, CourseGlossaryTerm>();

  for (const item of lesson.streamItems) {
    if (item.type !== 'task_content') continue;
    for (const block of item.blocks) {
      if (block.type !== 'key_point') continue;
      const extracted = extractTermFromKeyPoint(block.points);
      const preferredTerm = (block.title && !GENERIC_TERM_TITLES.has(normalizeTermTitle(block.title))
        ? conciseTerm(block.title)
        : extracted.term ?? conciseTerm(item.title));
      const definition = extracted.definition ?? block.points[0] ?? '';
      if (!preferredTerm || !definition) continue;

      const id = termIdFromTitle(preferredTerm);
      const existing = terms.get(id);
      const sourceRefs = normalizeSourceRefs(item.sourceRefs);
      if (!existing) {
        terms.set(id, {
          termId: id,
          preferredTerm,
          aliases: [],
          definition,
          avoidTerms: [],
          sourceRefs,
          updatedAt: now,
        });
        continue;
      }

      existing.definition = existing.definition || definition;
      existing.updatedAt = now;
      existing.sourceRefs = normalizeSourceRefs([...(existing.sourceRefs ?? []), ...sourceRefs]);
    }
  }

  return [...terms.values()];
}

export function buildChapterReference(
  lesson: NodeLesson,
  chapterTitle: string,
  now: number,
): CourseReference | null {
  const blocks: LearningContentBlock[] = [];
  const sourceRefs: SourceRef[] = [];

  for (const item of lesson.streamItems) {
    if (item.type !== 'task_content') continue;
    blocks.push(...item.blocks.filter((block) => REFERENCE_BLOCK_TYPES.has(block.type)));
    sourceRefs.push(...(item.sourceRefs ?? []));
  }

  if (blocks.length === 0) return null;

  return {
    referenceId: `ref-${lesson.chapterId}`,
    courseId: '',
    chapterId: lesson.chapterId,
    type: 'cheatsheet',
    title: `${chapterTitle} 速查`,
    blocks,
    sourceRefs: normalizeSourceRefs(sourceRefs),
    updatedAt: now,
  };
}

export function mergeCourseAssets(
  course: StoredCourse,
  lesson: NodeLesson,
  chapterTitle: string,
  now: number,
): StoredCourse {
  const reference = buildChapterReference(lesson, chapterTitle, now);
  const glossary = buildChapterGlossary(lesson, now);
  const references = [...(course.references ?? [])].filter(
    (item) => item.referenceId !== reference?.referenceId,
  );
  if (reference) references.push({ ...reference, courseId: course.courseId });

  const glossaryMap = new Map((course.glossary ?? []).map((term) => [term.termId, term]));
  for (const term of glossary) glossaryMap.set(term.termId, { ...glossaryMap.get(term.termId), ...term });

  return {
    ...course,
    references: references.sort((a, b) => (a.chapterId ?? '').localeCompare(b.chapterId ?? '')),
    glossary: [...glossaryMap.values()].sort((a, b) => a.preferredTerm.localeCompare(b.preferredTerm, 'zh-Hans-CN')),
  };
}
