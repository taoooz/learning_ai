// scripts/test-generation.ts
// 测试课程生成流程

const API_BASE = 'http://localhost:3000';

async function testTocGeneration() {
  console.log('='.repeat(60));
  console.log('测试 1: 课程目录生成 (TOC)');
  console.log('='.repeat(60));

  const startTime = Date.now();

  // TOC API 需要完整的 blueprint 结构
  const blueprint = {
    topic: 'TypeScript 类型系统入门',
    learnerPositioning: {
      estimatedLevel: 'beginner' as const,
      backgroundSummary: '有一些编程基础，了解 JavaScript',
      skipBasics: [] as string[],
    },
  };

  const response = await fetch(`${API_BASE}/api/generate/toc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blueprint }),
  });

  const data = await response.json();
  const elapsed = Date.now() - startTime;

  console.log('\n--- 响应状态 ---');
  console.log('HTTP Status:', response.status);
  console.log('总耗时:', elapsed, 'ms');

  if (data.generationMeta) {
    console.log('\n--- generationMeta ---');
    console.log(JSON.stringify(data.generationMeta, null, 2));
  }

  console.log('\n--- 课程目录预览 ---');
  if (data.courseName) {
    console.log('courseName:', data.courseName);
  }
  if (data.nodes) {
    console.log('节点数量:', data.nodes.length);
    data.nodes.slice(0, 3).forEach((node: any, i: number) => {
      console.log(`  节点 ${i}: ${node.title}`);
    });
  }

  return data;
}

async function testNodeGeneration(topic: string, blueprint: any, nodeIndex: number = 0) {
  console.log('\n' + '='.repeat(60));
  console.log(`测试 2: 节点 ${nodeIndex} 内容生成`);
  console.log('='.repeat(60));

  const startTime = Date.now();

  const response = await fetch(`${API_BASE}/api/generate/node`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic,
      blueprint,
      nodeIndex,
      userProfile: {
        targetJob: '前端开发',
        workExperience: [],
        education: [],
      },
    }),
  });

  const data = await response.json();
  const elapsed = Date.now() - startTime;

  console.log('\n--- 响应状态 ---');
  console.log('HTTP Status:', response.status);
  console.log('总耗时:', elapsed, 'ms');

  if (data.generationMeta) {
    console.log('\n--- generationMeta ---');
    console.log(JSON.stringify(data.generationMeta, null, 2));
  }

  console.log('\n--- 节点内容预览 ---');
  console.log('title:', data.title);
  console.log('teachingGoal:', data.teachingGoal);
  console.log('cards 数量:', data.cards?.length);
  console.log('questions 数量:', data.questions?.length);

  if (data.cards?.length > 0) {
    console.log('\n--- 前两张卡片 ---');
    data.cards.slice(0, 2).forEach((card: any, i: number) => {
      console.log(`  卡片 ${i + 1}: ${card.title}`);
      console.log(`    内容预览: ${card.content?.substring(0, 100)}...`);
    });
  }

  if (data.questions?.length > 0) {
    console.log('\n--- 第一道题 ---');
    const q = data.questions[0];
    console.log(`  ${q.type}: ${q.question}`);
    console.log(`  选项: ${q.options?.join(', ')}`);
    console.log(`  答案: ${q.answer}`);
  }

  return data;
}

async function testCardsGeneration(topic: string, nodeInfo: any) {
  console.log('\n' + '='.repeat(60));
  console.log('测试 3: 知识卡片生成');
  console.log('='.repeat(60));

  const startTime = Date.now();

  const response = await fetch(`${API_BASE}/api/generate/node/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic,
      nodeInfo,
      learnerBackground: {
        backgroundSummary: '有一些编程基础，了解 JavaScript',
        skipBasics: [],
      },
    }),
  });

  const data = await response.json();
  const elapsed = Date.now() - startTime;

  console.log('\n--- 响应状态 ---');
  console.log('HTTP Status:', response.status);
  console.log('总耗时:', elapsed, 'ms');

  console.log('\n--- 卡片预览 ---');
  console.log('cards 数量:', data.cards?.length);

  if (data.cards?.length > 0) {
    data.cards.slice(0, 2).forEach((card: any, i: number) => {
      console.log(`  卡片 ${i + 1}: ${card.title}`);
      if (card.visualization) {
        console.log(`    可视化类型: ${card.visualization.type}`);
      }
    });
  }

  return data;
}

async function main() {
  try {
    // 测试 TOC 生成
    const tocData = await testTocGeneration();

    if (tocData.nodes && tocData.nodes.length > 0) {
      // 构建完整的 blueprint 用于节点生成
      const blueprint = {
        courseId: `test-${Date.now()}`,
        topic: tocData.courseName || '测试课程',
        learnerPositioning: {
          estimatedLevel: 'beginner' as const,
          backgroundSummary: '有一些编程基础',
          skipBasics: [] as string[],
        },
        nodes: tocData.nodes.map((n: any, i: number) => ({
          index: i,
          title: n.title,
          teachingGoal: n.teachingGoal,
          status: 'available' as const,
          teachConceptIds: [],
          prerequisiteConceptIds: [],
          bridgeFromPreviousNode: '',
        })),
      };

      // 测试节点内容生成
      await testNodeGeneration(blueprint.topic, blueprint, 0);

      // 测试单独的知识卡片生成
      await testCardsGeneration(blueprint.topic, {
        teachingGoal: tocData.nodes[0].teachingGoal,
        teachConceptIds: [],
        prerequisiteConceptIds: [],
      });
    }

    console.log('\n' + '='.repeat(60));
    console.log('测试完成');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('测试失败:', error);
  }
}

main();
