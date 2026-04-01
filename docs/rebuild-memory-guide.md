# 重建 V3 记忆数据

## 步骤 1：在浏览器控制台运行以下代码

打开浏览器开发者工具（F12），切换到 Console 标签，复制粘贴以下代码并回车：

```javascript
// 重建 V3 记忆数据
(function() {
  console.log('=== 开始重建 V3 记忆数据 ===\n');

  // 1. 读取并备份
  const oldV3 = localStorage.getItem('userMemoryV3');
  if (!oldV3) {
    console.log('❌ 没有找到 V3 数据，请先使用应用生成一些数据');
    return;
  }

  const timestamp = Date.now();
  localStorage.setItem(`userMemoryV3_backup_${timestamp}`, oldV3);
  console.log(`✅ 已备份（后缀: _backup_${timestamp}）\n`);

  // 2. 解析数据
  const memoryV3 = JSON.parse(oldV3);
  console.log('当前数据：');
  console.log('- Events:', memoryV3.events?.length || 0);
  console.log('- Concepts:', memoryV3.projections?.conceptProjections?.length || 0);
  console.log('- Topics:', memoryV3.projections?.topicProjections?.length || 0);
  console.log('- Courses:', memoryV3.projections?.episodicProjections?.filter(e => e.kind === 'course').length || 0);

  // 3. 应用清理规则
  console.log('\n=== 应用清理规则 ===');
  
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MASTERY_DECAY_HALF_LIFE_DAYS = 30;
  const CONCEPT_CLEANUP_THRESHOLD = 0.3;
  const CONCEPT_CLEANUP_AGE_DAYS = 90;

  // 清理过期概念
  const originalConceptCount = memoryV3.projections.conceptProjections.length;
  memoryV3.projections.conceptProjections = memoryV3.projections.conceptProjections.filter(concept => {
    const daysSinceReview = (now - concept.updatedAt) / DAY_MS;
    const decayedMastery = concept.masteryScore * Math.exp(-daysSinceReview / MASTERY_DECAY_HALF_LIFE_DAYS);
    const ageInDays = (now - concept.updatedAt) / DAY_MS;
    
    return decayedMastery >= CONCEPT_CLEANUP_THRESHOLD || ageInDays < CONCEPT_CLEANUP_AGE_DAYS;
  });
  console.log(`✓ 清理概念: ${originalConceptCount} → ${memoryV3.projections.conceptProjections.length}`);

  // 限制数据规模
  const MAX_CONCEPTS = 200;
  const MAX_TOPICS = 50;
  const MAX_COURSES = 30;
  const MAX_EVENTS = 300;

  if (memoryV3.projections.conceptProjections.length > MAX_CONCEPTS) {
    memoryV3.projections.conceptProjections = memoryV3.projections.conceptProjections
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CONCEPTS);
    console.log(`✓ 限制概念: → ${MAX_CONCEPTS}`);
  }

  if (memoryV3.projections.topicProjections.length > MAX_TOPICS) {
    memoryV3.projections.topicProjections = memoryV3.projections.topicProjections
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_TOPICS);
    console.log(`✓ 限制主题: → ${MAX_TOPICS}`);
  }

  const courseEpisodes = memoryV3.projections.episodicProjections.filter(e => e.kind === 'course');
  if (courseEpisodes.length > MAX_COURSES) {
    const keptCourses = courseEpisodes
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_COURSES);
    const keptCourseIds = new Set(keptCourses.map(c => c.courseId));
    memoryV3.projections.episodicProjections = memoryV3.projections.episodicProjections.filter(
      e => e.kind !== 'course' || keptCourseIds.has(e.courseId)
    );
    console.log(`✓ 限制课程: → ${MAX_COURSES}`);
  }

  if (memoryV3.events.length > MAX_EVENTS) {
    memoryV3.events = memoryV3.events
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, MAX_EVENTS);
    console.log(`✓ 限制事件: → ${MAX_EVENTS}`);
  }

  // 4. 保存
  memoryV3.updatedAt = now;
  localStorage.setItem('userMemoryV3', JSON.stringify(memoryV3));
  
  console.log('\n✅ 重建完成！');
  console.log('\n最终数据：');
  console.log('- Events:', memoryV3.events.length);
  console.log('- Concepts:', memoryV3.projections.conceptProjections.length);
  console.log('- Topics:', memoryV3.projections.topicProjections.length);
  console.log('- Courses:', memoryV3.projections.episodicProjections.filter(e => e.kind === 'course').length);

  console.log('\n📝 请刷新页面以应用新的记忆系统');
})();
```

## 步骤 2：刷新页面

重建完成后，刷新页面（F5 或 Cmd+R），新的记忆系统会自动生效。

## 步骤 3：验证

在控制台运行以下代码验证：

```javascript
// 验证记忆数据
const v3 = JSON.parse(localStorage.getItem('userMemoryV3'));
console.log('验证结果：');
console.log('- Events:', v3.events.length, '(应 ≤ 300)');
console.log('- Concepts:', v3.projections.conceptProjections.length, '(应 ≤ 200)');
console.log('- Topics:', v3.projections.topicProjections.length, '(应 ≤ 50)');
console.log('- Courses:', v3.projections.episodicProjections.filter(e => e.kind === 'course').length, '(应 ≤ 30)');
```

## 如果需要完全重置

如果想从头开始，运行：

```javascript
// 完全重置记忆数据
localStorage.removeItem('userMemory');
localStorage.removeItem('userMemoryV2');
localStorage.removeItem('userMemoryV3');
console.log('✅ 已清空所有记忆数据，刷新页面后会重新初始化');
```

## 恢复备份

如果重建后有问题，可以恢复备份：

```javascript
// 查看所有备份
Object.keys(localStorage).filter(k => k.includes('backup')).forEach(k => console.log(k));

// 恢复最新备份（替换时间戳）
const backup = localStorage.getItem('userMemoryV3_backup_1234567890');
if (backup) {
  localStorage.setItem('userMemoryV3', backup);
  console.log('✅ 已恢复备份');
  location.reload();
}
```
