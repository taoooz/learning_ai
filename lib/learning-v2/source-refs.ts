// lib/learning-v2/source-refs.ts
// 来源引用展示的纯函数：清洗、去重、限制数量，并保证只渲染 http(s) 外链

import type { SourceRef } from '@/types/learning-v2';

/** 单节最多展示 4 条，避免参考信息喧宾夺主 */
const MAX_VISIBLE_SOURCE_REFS = 4;

/** 判断外链是否安全可点击；只允许 http/https，不渲染 javascript: 等协议 */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 提取展示用域名；解析失败返回空串，UI 可降级只显示标题 */
export function getSourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 标题为空时用域名兜底；仍为空时用 URL，保证来源可辨识 */
export function getSourceDisplayTitle(source: SourceRef): string {
  const title = source.title?.trim();
  if (title) return title;
  const domain = getSourceDomain(source.url);
  if (domain) return domain;
  return source.url?.trim() ?? '';
}

/** 展示前清洗来源：过滤空项/非法外链、按 URL 去重、限制展示数量 */
export function getDisplaySourceRefs(sources: SourceRef[] | undefined): SourceRef[] {
  if (!Array.isArray(sources)) return [];
  const seenUrls = new Set<string>();
  const result: SourceRef[] = [];

  for (const source of sources) {
    const url = source?.url?.trim() ?? '';
    if (!url || !isSafeHttpUrl(url) || seenUrls.has(url)) continue;
    const title = source?.title?.trim();
    if (!title && !getSourceDomain(url)) continue;

    seenUrls.add(url);
    result.push({
      title: title || getSourceDomain(url),
      url,
      evidenceId: source.evidenceId,
      kind: source.kind,
      useFor: source.useFor,
      isPrimary: source.isPrimary,
    });
    if (result.length >= MAX_VISIBLE_SOURCE_REFS) break;
  }

  return result;
}

export interface EvidenceDisplayRef {
  displayIndex: number;
  refId: string;
}

/** 只按 evidenceId 精确匹配角标；不再按 ev-N 序号猜测旧来源。 */
export function resolveEvidenceDisplayRefs(
  evidenceRefs: string[] | undefined,
  sources: SourceRef[] | undefined,
): EvidenceDisplayRef[] {
  if (!evidenceRefs?.length || !sources?.length) return [];
  const display = getDisplaySourceRefs(sources);
  return evidenceRefs.flatMap((refId) => {
    const index = display.findIndex((source) => source.evidenceId === refId);
    return index >= 0 ? [{ displayIndex: index + 1, refId }] : [];
  });
}
