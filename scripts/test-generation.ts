// scripts/test-generation.ts
// 测试课程生成流程

const API_BASE = 'http://localhost:3000';

async function testCourseGeneration() {
  console.log('='.repeat(60));
  console.log('测试 1: 课程目录生成');
  console.log('='.repeat(60));

  const startTime = Date.now();

  const response = await fetch(`${API_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: 'TypeScript 类型系统入门',
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

  console.log('\n--- generationMeta ---');
  console.log(JSON.stringify(data.generationMeta, null, 2));

  console.log('\n--- 课程目录预览 ---');
  if (data.blueprint) {
    console.log('courseId:', data.blueprint.courseId);
    console.log('topic:', data.blueprint.topic);
    console.log('difficultySummary:', data.blueprint.learnerPositioning?.difficultySummary);
    console.log('节点数量:', data.blueprint.nodes?.length);
    data.blueprint.nodes?.slice(0, 3).forEach((node: any, i: number) => {
      console.log(`  节点 ${i}: ${node.title} (${node.status})`);
    });
  }

  if (data.treeView) {
    console.log('\n--- treeView ---');
    console.log(JSON.stringify(data.treeView, null, 2));
  }

  // 检查是否有第一节内容自动生成
  console.log('\n--- 检查第一节内容 ---');
  // 注意：自动触发是在前端 CourseContext 完成的，这里只测试 API

  return data;
}

async function testNodeGeneration(blueprint: any, nodeIndex: number = 0) {
  console.log('\n' + '='.repeat(60));
  console.log(`测试 2: 节点 ${nodeIndex} 内容生成`);
  console.log('='.repeat(60));

  const startTime = Date.now();

  const response = await fetch(`${API_BASE}/api/generate/node`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: blueprint.topic,
      blueprint: blueprint,
      nodeIndex: nodeIndex,
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

  console.log('\n--- generationMeta ---');
  console.log(JSON.stringify(data.generationMeta, null, 2));

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

async function main() {
  try {
    // 测试课程目录生成
    const courseData = await testCourseGeneration();

    if (courseData.blueprint) {
      // 测试节点内容生成
      await testNodeGeneration(courseData.blueprint, 0);
    }

    console.log('\n' + '='.repeat(60));
    console.log('测试完成');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('测试失败:', error);
  }
}

main();
