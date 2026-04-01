// lib/memory/concept-graph.ts
import type { CourseBlueprint } from '@/types/course';

export type ConceptGraph = {
  [conceptId: string]: {
    name: string;
    prerequisiteOf: string[]; // 此概念是哪些概念的前置
    aliases?: string[];
  };
};

let cachedGraph: ConceptGraph | null = null;

/** 从 blueprints 构建概念图谱 */
export function buildConceptGraph(blueprints: CourseBlueprint[]): ConceptGraph {
  const graph: ConceptGraph = {};

  blueprints.forEach(blueprint => {
    // 先注册所有概念
    blueprint.globalConcepts?.forEach(concept => {
      if (!graph[concept.id]) {
        graph[concept.id] = {
          name: concept.name,
          prerequisiteOf: [],
          aliases: concept.aliases,
        };
      }
    });

    // 构建前置关系
    blueprint.nodes.forEach(node => {
      const teachConcepts = node.teachConceptIds || [];
      const prerequisites = node.prerequisiteConceptIds || [];

      teachConcepts.forEach(conceptId => {
        if (!graph[conceptId]) {
          graph[conceptId] = { name: conceptId, prerequisiteOf: [] };
        }

        prerequisites.forEach(preId => {
          if (!graph[preId]) {
            graph[preId] = { name: preId, prerequisiteOf: [] };
          }
          if (!graph[preId].prerequisiteOf.includes(conceptId)) {
            graph[preId].prerequisiteOf.push(conceptId);
          }
        });
      });
    });
  });

  return graph;
}

/** 获取概念图谱（懒加载 + 缓存） */
export function getConceptGraph(blueprints: CourseBlueprint[]): ConceptGraph {
  if (!cachedGraph && blueprints.length > 0) {
    cachedGraph = buildConceptGraph(blueprints);
    console.log('[ConceptGraph] Built graph with', Object.keys(cachedGraph).length, 'concepts');
  }
  return cachedGraph || {};
}

/** 清除缓存（用于测试或数据更新） */
export function clearConceptGraphCache() {
  cachedGraph = null;
}

/** 查询概念的前置依赖（递归，最多 2 层） */
export function getPrerequisites(
  conceptIds: string[],
  graph: ConceptGraph,
  maxDepth: number = 2
): string[] {
  const result = new Set<string>();
  const queue: Array<{ id: string; level: number }> = conceptIds.map(id => ({ id, level: 0 }));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const { id, level } = queue.shift()!;
    if (visited.has(id) || level >= maxDepth) continue;
    visited.add(id);

    // 找到所有前置概念
    Object.entries(graph).forEach(([preId, node]) => {
      if (node.prerequisiteOf.includes(id)) {
        result.add(preId);
        queue.push({ id: preId, level: level + 1 });
      }
    });
  }

  return Array.from(result);
}

/** 查询相似概念（通过别名匹配） */
export function getSimilarConcepts(conceptId: string, graph: ConceptGraph): string[] {
  const concept = graph[conceptId];
  if (!concept || !concept.aliases || concept.aliases.length === 0) {
    return [];
  }

  const similar: string[] = [];
  const conceptAliases = new Set(concept.aliases.map(a => a.toLowerCase()));

  Object.entries(graph).forEach(([otherId, otherNode]) => {
    if (otherId === conceptId) return;
    if (!otherNode.aliases) return;

    const hasOverlap = otherNode.aliases.some(alias => conceptAliases.has(alias.toLowerCase()));
    if (hasOverlap) {
      similar.push(otherId);
    }
  });

  return similar;
}
