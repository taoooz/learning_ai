const PATH_OFFSETS = [0, 14, -8, 12, -14, 8, -6, 10];
const START_TOP = 18;
const NODE_STEP = 108;
const NODE_GAP = 24;
const NODE_BUTTON_BOTTOM = 84;
const CARD_TOP_OFFSET = 8;
const CARD_VERTICAL_PADDING = 20;
const CARD_BADGE_HEIGHT = 10;
const CARD_BADGE_GAP = 4;
const CARD_CONTENT_WIDTH = 172;
const CARD_MAX_TITLE_LINES = 3;

type CourseTreeLayoutInput = number | {
  index: number;
  title?: string;
  status?: 'locked' | 'available' | 'completed';
};

export interface CourseTreeLayoutItem {
  index: number;
  offset: number;
  top: number;
}

function estimateCharacterWidth(char: string, fontSize: number) {
  if (/\s/.test(char)) return fontSize * 0.3;
  if (/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(char)) return fontSize;
  if (/[A-Z]/.test(char)) return fontSize * 0.7;
  if (/[a-z0-9]/.test(char)) return fontSize * 0.56;
  if (/[，。！？；：、“”‘’（）《》【】]/.test(char)) return fontSize * 0.52;
  if (/[.,!?;:()[\]{}\-_/]/.test(char)) return fontSize * 0.36;
  return fontSize * 0.62;
}

function estimateWrappedLineCount(text: string, maxWidth: number, fontSize: number) {
  if (!text.trim()) return 1;

  const paragraphs = text.split(/\r?\n/);
  let totalLines = 0;

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      totalLines += 1;
      continue;
    }

    let currentLineWidth = 0;
    let lineCount = 1;

    for (const char of paragraph) {
      const charWidth = estimateCharacterWidth(char, fontSize);

      if (currentLineWidth > 0 && currentLineWidth + charWidth > maxWidth) {
        lineCount += 1;
        currentLineWidth = charWidth;
        continue;
      }

      currentLineWidth += charWidth;
    }

    totalLines += lineCount;
  }

  return Math.max(1, totalLines);
}

function estimateCourseTreeNodeHeight(node: CourseTreeLayoutInput) {
  if (typeof node === 'number' || !node.title) {
    return NODE_STEP - NODE_GAP;
  }

  const isCurrent = node.status === 'available';
  const titleFontSize = isCurrent ? 16 : 15;
  const titleLineHeight = isCurrent ? 22 : 21;
  const titleLineCount = Math.min(
    CARD_MAX_TITLE_LINES,
    estimateWrappedLineCount(node.title, CARD_CONTENT_WIDTH, titleFontSize),
  );
  const titleHeight = titleLineCount * titleLineHeight;
  const cardHeight = CARD_VERTICAL_PADDING + CARD_BADGE_HEIGHT + CARD_BADGE_GAP + titleHeight;

  return Math.max(NODE_BUTTON_BOTTOM, CARD_TOP_OFFSET + cardHeight);
}

export function getCourseTreeLayout(nodes: CourseTreeLayoutInput[]): CourseTreeLayoutItem[] {
  let currentTop = START_TOP;

  return nodes.map((node, index) => {
    const item = {
      index: typeof node === 'number' ? node : node.index,
      offset: PATH_OFFSETS[index % PATH_OFFSETS.length],
      top: currentTop,
    };

    currentTop += estimateCourseTreeNodeHeight(node) + NODE_GAP;
    return item;
  });
}

export function getCourseTreeHeight(nodesOrCount: CourseTreeLayoutInput[] | number) {
  if (typeof nodesOrCount === 'number') {
    return START_TOP + nodesOrCount * NODE_STEP + 36;
  }

  if (nodesOrCount.length === 0) {
    return START_TOP + 36;
  }

  const layout = getCourseTreeLayout(nodesOrCount);
  const lastNode = nodesOrCount[nodesOrCount.length - 1];
  const lastLayout = layout[layout.length - 1];

  return lastLayout.top + estimateCourseTreeNodeHeight(lastNode) + 36;
}

export function getCourseTreeInitialScrollTop(params: {
  nodeTop: number;
  viewportHeight: number;
  offsetRatio?: number;
}) {
  const { nodeTop, viewportHeight, offsetRatio = 0.26 } = params;
  return Math.max(0, Math.round(nodeTop - viewportHeight * offsetRatio));
}
