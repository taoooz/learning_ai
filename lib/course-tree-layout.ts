const PATH_OFFSETS = [0, 14, -8, 12, -14, 8, -6, 10];
const NODE_STEP = 108;
const START_TOP = 18;

export interface CourseTreeLayoutItem {
  index: number;
  offset: number;
  top: number;
}

export function getCourseTreeLayout(nodes: Array<number | { index: number }>): CourseTreeLayoutItem[] {
  return nodes.map((node, index) => ({
    index: typeof node === 'number' ? node : node.index,
    offset: PATH_OFFSETS[index % PATH_OFFSETS.length],
    top: START_TOP + index * NODE_STEP,
  }));
}

export function getCourseTreeHeight(nodeCount: number) {
  return START_TOP + nodeCount * NODE_STEP + 36;
}

export function getCourseTreeInitialScrollTop(params: {
  nodeTop: number;
  viewportHeight: number;
  offsetRatio?: number;
}) {
  const { nodeTop, viewportHeight, offsetRatio = 0.26 } = params;
  return Math.max(0, Math.round(nodeTop - viewportHeight * offsetRatio));
}
