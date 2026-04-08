/**
 * Markdown 协议解析器
 * 支持在流式内容中嵌入结构化组件（HTML 标签格式）
 * 核心能力：遇到开标签立即渲染对应样式的块，内容流式填充
 */

export type ContentBlock =
  | { type: 'text'; content: string }
  | { type: 'question'; id: string; question: string; options: Record<string, string>; complete: boolean }
  | { type: 'outline'; learningDirection: string; learningGoal: string; estimatedLevel: string; backgroundSummary?: string; skipBasics?: string[]; complete: boolean };

export function extractThinkingAndVisibleContent(content: string): {
  thinkingContent: string;
  visibleContent: string;
  hasOpenThinkBlock: boolean;
} {
  if (!content) {
    return { thinkingContent: '', visibleContent: '', hasOpenThinkBlock: false };
  }

  let cursor = 0;
  let visibleContent = '';
  let thinkingContent = '';
  let hasOpenThinkBlock = false;

  while (cursor < content.length) {
    const openIndex = content.indexOf('<think>', cursor);

    if (openIndex < 0) {
      visibleContent += content.slice(cursor);
      break;
    }

    visibleContent += content.slice(cursor, openIndex);

    const thinkStart = openIndex + '<think>'.length;
    const closeIndex = content.indexOf('</think>', thinkStart);

    if (closeIndex < 0) {
      thinkingContent += content.slice(thinkStart);
      hasOpenThinkBlock = true;
      break;
    }

    thinkingContent += content.slice(thinkStart, closeIndex);
    cursor = closeIndex + '</think>'.length;
  }

  return {
    thinkingContent: thinkingContent.trim(),
    visibleContent: visibleContent.trim(),
    hasOpenThinkBlock,
  };
}

export function getStreamingThinkingState(input: {
  sawThinkTag: boolean;
  hasOpenThinkBlock: boolean;
  hasThinkingContent: boolean;
}): boolean {
  if (input.sawThinkTag) {
    return input.hasOpenThinkBlock;
  }

  return input.hasThinkingContent;
}

function extractSlotContent(content: string, slot: string, nextSlotPattern?: string): string {
  const tailPattern = nextSlotPattern ? `(?=<\\/div>|${nextSlotPattern}|$)` : '(?=<\\/div>|$)';
  const regex = new RegExp(`<div\\s+slot="${slot}">([\\s\\S]*?)${tailPattern}`);
  const match = content.match(regex);
  return match ? match[1].trim() : '';
}

function normalizeLevel(level: string): string {
  const levelMap: Record<string, string> = {
    '入门': 'novice',
    '初级': 'beginner',
    '中级': 'intermediate',
    '高级': 'advanced',
  };

  return levelMap[level] || 'beginner';
}

function normalizeKnowledge(knowledge: string): string[] | undefined {
  if (!knowledge) return undefined;

  const items = knowledge
    .split(/[;；]/)
    .map((item) => item.replace(/^已掌握\d+[:：]\s*/, '').trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

function parsePartialQuiz(id: string, partialContent: string): ContentBlock {
  const question = extractSlotContent(partialContent, 'question', '<div\\s+slot="option_[A-Z]">');
  const options: Record<string, string> = {};
  const optionRegex = /<div\s+slot="option_([A-Z])">([\s\S]*?)(?=<\/div>|<div\s+slot="option_[A-Z]">|$)/g;
  let optionMatch: RegExpExecArray | null;

  while ((optionMatch = optionRegex.exec(partialContent)) !== null) {
    options[optionMatch[1]] = optionMatch[2].trim();
  }

  return { type: 'question', id, question, options, complete: false };
}

function parseCompleteQuiz(id: string, quizContent: string): ContentBlock {
  const questionMatch = quizContent.match(/<div\s+slot="question">([\s\S]*?)<\/div>/);
  const question = questionMatch ? questionMatch[1].trim() : '';
  const options: Record<string, string> = {};
  const optionRegex = /<div\s+slot="option_([A-Z])">([\s\S]*?)<\/div>/g;
  let optionMatch: RegExpExecArray | null;

  while ((optionMatch = optionRegex.exec(quizContent)) !== null) {
    options[optionMatch[1]] = optionMatch[2].trim();
  }

  return { type: 'question', id, question, options, complete: true };
}

function parsePartialOutline(partialContent: string): ContentBlock {
  const learningDirection = extractSlotContent(partialContent, 'direction', '<div\\s+slot="object">');
  const learningGoal = extractSlotContent(partialContent, 'object', '<div\\s+slot="level">');
  const estimatedLevel = normalizeLevel(
    extractSlotContent(partialContent, 'level', '<div\\s+slot="background">|<div\\s+slot="knowledge">'),
  );
  const backgroundSummary = extractSlotContent(partialContent, 'background', '<div\\s+slot="knowledge">') || undefined;
  const skipBasics = normalizeKnowledge(extractSlotContent(partialContent, 'knowledge'));

  return {
    type: 'outline',
    learningDirection,
    learningGoal,
    estimatedLevel,
    backgroundSummary,
    skipBasics,
    complete: false,
  };
}

function parseCompleteOutline(outlineContent: string): ContentBlock {
  const directionMatch = outlineContent.match(/<div\s+slot="direction">([\s\S]*?)<\/div>/);
  const objectMatch = outlineContent.match(/<div\s+slot="object">([\s\S]*?)<\/div>/);
  const levelMatch = outlineContent.match(/<div\s+slot="level">([\s\S]*?)<\/div>/);
  const backgroundMatch = outlineContent.match(/<div\s+slot="background">([\s\S]*?)<\/div>/);
  const knowledgeMatch = outlineContent.match(/<div\s+slot="knowledge">([\s\S]*?)<\/div>/);

  return {
    type: 'outline',
    learningDirection: directionMatch ? directionMatch[1].trim() : '',
    learningGoal: objectMatch ? objectMatch[1].trim() : '',
    estimatedLevel: normalizeLevel(levelMatch ? levelMatch[1].trim() : ''),
    backgroundSummary: backgroundMatch ? backgroundMatch[1].trim() : undefined,
    skipBasics: normalizeKnowledge(knowledgeMatch ? knowledgeMatch[1].trim() : ''),
    complete: true,
  };
}

/**
 * 解析带结构化标记的内容（HTML 标签格式）
 * 支持不完整标签的流式渲染：遇到开标签立即创建块，内容渐进填充
 */
export function parseStreamContent(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const openTagRegex = /<quiz\s+id="(\d+)">|<outline>/g;
  let cursor = 0;

  const pushText = (text: string) => {
    const trimmed = text.trim();
    if (trimmed) {
      blocks.push({ type: 'text', content: trimmed });
    }
  };

  while (cursor < content.length) {
    openTagRegex.lastIndex = cursor;
    const match = openTagRegex.exec(content);

    if (!match) {
      pushText(content.slice(cursor));
      break;
    }

    pushText(content.slice(cursor, match.index));

    if (match[0].startsWith('<quiz')) {
      const id = match[1];
      const bodyStart = match.index + match[0].length;
      const closeIndex = content.indexOf('</quiz>', bodyStart);

      if (closeIndex >= 0) {
        blocks.push(parseCompleteQuiz(id, content.slice(bodyStart, closeIndex)));
        cursor = closeIndex + '</quiz>'.length;
      } else {
        blocks.push(parsePartialQuiz(id, content.slice(bodyStart)));
        cursor = content.length;
      }

      continue;
    }

    const bodyStart = match.index + match[0].length;
    const closeIndex = content.indexOf('</outline>', bodyStart);

    if (closeIndex >= 0) {
      blocks.push(parseCompleteOutline(content.slice(bodyStart, closeIndex)));
      cursor = closeIndex + '</outline>'.length;
    } else {
      blocks.push(parsePartialOutline(content.slice(bodyStart)));
      cursor = content.length;
    }
  }

  return blocks;
}

/**
 * 检查内容是否包含未完成的结构化块
 */
export function hasIncompleteBlock(content: string): boolean {
  const openQuiz = (content.match(/<quiz/g) || []).length;
  const closeQuiz = (content.match(/<\/quiz>/g) || []).length;
  const openOutline = (content.match(/<outline>/g) || []).length;
  const closeOutline = (content.match(/<\/outline>/g) || []).length;
  return openQuiz > closeQuiz || openOutline > closeOutline;
}
