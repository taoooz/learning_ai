/**
 * Markdown 协议解析器
 * 支持在流式内容中嵌入结构化组件（HTML 标签格式）
 */

export type ContentBlock =
  | { type: 'text'; content: string }
  | { type: 'question'; id: string; question: string; options: Record<string, string> }
  | { type: 'outline'; learningDirection: string; learningGoal: string; estimatedLevel: string; backgroundSummary?: string; skipBasics?: string[] };

/**
 * 解析带结构化标记的内容（HTML 标签格式）
 */
export function parseStreamContent(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let textBuffer = '';

  const flushText = () => {
    if (textBuffer.trim()) {
      blocks.push({ type: 'text', content: textBuffer.trim() });
      textBuffer = '';
    }
  };

  // 解析 <quiz> 标签
  const quizRegex = /<quiz\s+id="(\d+)">([\s\S]*?)<\/quiz>/g;
  let lastIndex = 0;
  let match;

  while ((match = quizRegex.exec(content)) !== null) {
    // 添加标签前的文本
    textBuffer += content.substring(lastIndex, match.index);
    flushText();

    const id = match[1];
    const quizContent = match[2];

    // 解析问题和选项
    const questionMatch = quizContent.match(/<div\s+slot="question">([\s\S]*?)<\/div>/);
    const question = questionMatch ? questionMatch[1].trim() : '';

    const options: Record<string, string> = {};
    const optionRegex = /<div\s+slot="option_([A-Z])">([\s\S]*?)<\/div>/g;
    let optionMatch;
    while ((optionMatch = optionRegex.exec(quizContent)) !== null) {
      options[optionMatch[1]] = optionMatch[2].trim();
    }

    blocks.push({ type: 'question', id, question, options });
    lastIndex = quizRegex.lastIndex;
  }

  // 解析 <outline> 标签
  const outlineRegex = /<outline>([\s\S]*?)<\/outline>/g;
  quizRegex.lastIndex = 0; // 重置
  
  const remainingContent = content.substring(lastIndex);
  const outlineMatch = outlineRegex.exec(remainingContent);
  
  if (outlineMatch) {
    textBuffer += remainingContent.substring(0, outlineMatch.index);
    flushText();

    const outlineContent = outlineMatch[1];
    
    const directionMatch = outlineContent.match(/<div\s+slot="direction">([\s\S]*?)<\/div>/);
    const objectMatch = outlineContent.match(/<div\s+slot="object">([\s\S]*?)<\/div>/);
    const levelMatch = outlineContent.match(/<div\s+slot="level">([\s\S]*?)<\/div>/);
    const backgroundMatch = outlineContent.match(/<div\s+slot="background">([\s\S]*?)<\/div>/);
    const knowledgeMatch = outlineContent.match(/<div\s+slot="knowledge">([\s\S]*?)<\/div>/);

    const learningDirection = directionMatch ? directionMatch[1].trim() : '';
    const learningGoal = objectMatch ? objectMatch[1].trim() : '';
    const level = levelMatch ? levelMatch[1].trim() : '初级';
    
    // 映射中文等级到英文
    const levelMap: Record<string, string> = {
      '入门': 'novice',
      '初级': 'beginner',
      '中级': 'intermediate',
      '高级': 'advanced',
    };
    const estimatedLevel = levelMap[level] || 'beginner';

    const backgroundSummary = backgroundMatch ? backgroundMatch[1].trim() : undefined;
    const skipBasics = knowledgeMatch 
      ? knowledgeMatch[1].split(/[;；]/).map(s => s.replace(/^已掌握\d+[:：]\s*/, '').trim()).filter(Boolean)
      : undefined;

    blocks.push({
      type: 'outline',
      learningDirection,
      learningGoal,
      estimatedLevel,
      backgroundSummary,
      skipBasics,
    });

    textBuffer += remainingContent.substring(outlineRegex.lastIndex);
  } else {
    textBuffer += remainingContent;
  }

  flushText();
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
