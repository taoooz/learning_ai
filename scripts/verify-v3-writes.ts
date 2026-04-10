#!/usr/bin/env node
/**
 * V3 内存写入验证脚本
 * 用法：npx tsx scripts/verify-v3-writes.ts
 */

import { createMemoryRepository } from '../lib/memory/repository';

const repository = createMemoryRepository();

console.log('=== V3 内存系统验证 ===\n');

// 1. 读取 V3 存储
const v3 = repository.getMemoryStoreV3();
console.log('1. V3 存储状态');
console.log(`   - Events 数量: ${v3.events.length}`);
console.log(`   - 概念投影: ${v3.projections.conceptProjections.length}`);
console.log(`   - 主题投影: ${v3.projections.topicProjections.length}`);
console.log(`   - 回忆投影: ${v3.projections.episodicProjections.length}`);
console.log(`   - 最后更新: ${new Date(v3.updatedAt).toISOString()}`);

// 2. 分析事件类型分布
const eventTypes = v3.events.reduce((acc, e) => {
  acc[e.type] = (acc[e.type] || 0) + 1;
  return acc;
}, {} as Record<string, number>);

console.log('\n2. 事件类型分布');
Object.entries(eventTypes).forEach(([type, count]) => {
  console.log(`   - ${type}: ${count}`);
});

// 3. 验证事件时间线
const sortedEvents = [...v3.events].sort((a, b) => b.occurredAt - a.occurredAt);
const recentEvents = sortedEvents.slice(0, 5);

console.log('\n3. 最近 5 个事件');
recentEvents.forEach((e, i) => {
  console.log(`   ${i + 1}. [${e.type}] ${new Date(e.occurredAt).toISOString()}`);
});

// 4. 验证 Profile 数据
console.log('\n4. Profile 数据验证');
console.log(`   - Stable Facts: ${v3.profile.stableFacts.length}`);
console.log(`   - Goals: ${v3.profile.goals.length}`);
console.log(`   - Preferences: ${v3.profile.preferences.length}`);

if (v3.profile.stableFacts.length === 0) {
  console.log('   警告：Profile.stableFacts 为空，可能未触发 V3 同步');
}

// 5. 数据完整性检查
console.log('\n5. 数据完整性检查');
const hasRecentEvents = v3.events.some(e => Date.now() - e.occurredAt < 7 * 24 * 60 * 60 * 1000);
console.log(`   - 最近 7 天有事件: ${hasRecentEvents ? '是' : '否'}`);

const hasQuestionEvents = v3.events.some(e => e.type === 'question_answered');
console.log(`   - 有答题记录: ${hasQuestionEvents ? '是' : '否'}`);

const hasNodeEvents = v3.events.some(e => e.type === 'node_completed');
console.log(`   - 有节点完成: ${hasNodeEvents ? '是' : '否'}`);

// 6. 总结
console.log('\n=== 验证总结 ===');
const totalIssues = [
  v3.profile.stableFacts.length === 0,
  !hasRecentEvents,
  !hasQuestionEvents,
].filter(Boolean).length;

if (totalIssues === 0) {
  console.log('V3 内存系统运行正常');
} else {
  console.log(`发现 ${totalIssues} 个问题需要关注`);
}

process.exit(totalIssues > 0 ? 1 : 0);
