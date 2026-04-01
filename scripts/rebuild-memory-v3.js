// scripts/rebuild-memory-v3.js
// 在浏览器控制台运行此脚本，重建 V3 记忆数据

(function() {
  console.log('=== 开始重建 V3 记忆数据 ===\n');

  // 1. 读取当前数据
  const oldV3 = localStorage.getItem('userMemoryV3');
  const oldV2 = localStorage.getItem('userMemoryV2');
  const oldV1 = localStorage.getItem('userMemory');
  const profile = localStorage.getItem('userProfile');

  console.log('当前数据状态：');
  console.log('- V3:', oldV3 ? '存在' : '不存在');
  console.log('- V2:', oldV2 ? '存在' : '不存在');
  console.log('- V1:', oldV1 ? '存在' : '不存在');
  console.log('- Profile:', profile ? '存在' : '不存在');

  if (!oldV3 && !oldV2 && !oldV1) {
    console.log('\n❌ 没有找到任何记忆数据');
    return;
  }

  // 2. 备份旧数据
  const timestamp = Date.now();
  if (oldV3) localStorage.setItem(`userMemoryV3_backup_${timestamp}`, oldV3);
  if (oldV2) localStorage.setItem(`userMemoryV2_backup_${timestamp}`, oldV2);
  if (oldV1) localStorage.setItem(`userMemory_backup_${timestamp}`, oldV1);
  console.log(`\n✅ 已备份旧数据（后缀: _backup_${timestamp}）`);

  // 3. 解析数据
  let memoryV3;
  try {
    if (oldV3) {
      memoryV3 = JSON.parse(oldV3);
    } else if (oldV2) {
      console.log('\n⚠️  只有 V2 数据，需要手动迁移到 V3');
      console.log('请刷新页面，系统会自动迁移');
      return;
    } else {
      console.log('\n⚠️  只有 V1 数据，需要手动迁移到 V3');
      console.log('请刷新页面，系统会自动迁移');
      return;
    }
  } catch (e) {
    console.error('❌ 数据解析失败:', e);
    return;
  }

  // 4. 分析当前数据
  console.log('\n=== 当前数据分析 ===');
  console.log('Events:', memoryV3.events?.length || 0);
  console.log('Concept Projections:', memoryV3.projections?.conceptProjections?.length || 0);
  console.log('Topic Projections:', memoryV3.projections?.topicProjections?.length || 0);
  console.log('Episodic Projections:', memoryV3.projections?.episodicProjections?.length || 0);

  // 5. 应用清理规则
  console.log('\n=== 应用清理规则 ===');
  
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MASTERY_DECAY_HALF_LIFE_DAYS = 30;
  const CONCEPT_CLEANUP_THRESHOLD = 0.3;
  const CONCEPT_CLEANUP_AGE_DAYS = 90;

  // 计算遗忘曲线
  function applyForgettingCurve(masteryScore, lastReviewedAt) {
    const daysSinceReview = (now - lastReviewedAt) / DAY_MS;
    return masteryScore * Math.exp(-daysSinceReview / MASTERY_DECAY_HALF_LIFE_DAYS);
  }

  // 清理过期概念
  const originalConceptCount = memoryV3.projections.conceptProjections.length;
  memoryV3.projections.conceptProjections = memoryV3.projections.conceptProjections.filter(concept => {
    const decayedMastery = applyForgettingCurve(concept.masteryScore, concept.updatedAt);
    const ageInDays = (now - concept.updatedAt) / DAY_MS;
    
    if (decayedMastery >= CONCEPT_CLEANUP_THRESHOLD) return true;
    if (ageInDays < CONCEPT_CLEANUP_AGE_DAYS) return true;
    
    return false;
  });
  console.log(`- 清理概念: ${originalConceptCount} → ${memoryV3.projections.conceptProjections.length}`);

  // 限制数据规模
  const MAX_CONCEPTS = 200;
  const MAX_TOPICS = 50;
  const MAX_COURSES = 30;
  const MAX_EVENTS = 300;

  if (memoryV3.projections.conceptProjections.length > MAX_CONCEPTS) {
    memoryV3.projections.conceptProjections = memoryV3.projections.conceptProjections
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CONCEPTS);
    console.log(`- 限制概念数量: → ${MAX_CONCEPTS}`);
  }

  if (memoryV3.projections.topicProjections.length > MAX_TOPICS) {
    memoryV3.projections.topicProjections = memoryV3.projections.topicProjections
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_TOPICS);
    console.log(`- 限制主题数量: → ${MAX_TOPICS}`);
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
    console.log(`- 限制课程数量: → ${MAX_COURSES}`);
  }

  if (memoryV3.events.length > MAX_EVENTS) {
    memoryV3.events = memoryV3.events
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, MAX_EVENTS);
    console.log(`- 限制事件数量: → ${MAX_EVENTS}`);
  }

  // 6. 保存清理后的数据
  memoryV3.updatedAt = now;
  localStorage.setItem('userMemoryV3', JSON.stringify(memoryV3));
  
  console.log('\n✅ 重建完成！');
  console.log('\n=== 最终数据 ===');
  console.log('Events:', memoryV3.events.length);
  console.log('Concept Projections:', memoryV3.projections.conceptProjections.length);
  console.log('Topic Projections:', memoryV3.projections.topicProjections.length);
  console.log('Episodic Projections:', memoryV3.projections.episodicProjections.length);

  console.log('\n📝 建议：刷新页面以应用新的记忆系统');
})();
