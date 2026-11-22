#!/usr/bin/env node
// 读取 Course Architect 批跑目录，把 architecture 编译为 Blueprint 并执行现有契约校验。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { compileCourseArchitecture } from '../lib/learning-v2/blueprint-from-architecture';
import { validateCourseBlueprint } from '../lib/learning-v2/validators';
import type { CourseArchitecture } from '../types/learning-v2/course-architecture';

const inputPath = resolve(process.argv[2] || '/tmp/course-architecture-batch');
const inputDir = statSync(inputPath).isDirectory() ? inputPath : resolve(inputPath, '..');
const files = statSync(inputPath).isDirectory()
  ? readdirSync(inputDir).filter((name) => name.endsWith('.json') && name !== 'summary.json')
  : [basename(inputPath)];
const results = [];

for (const [index, filename] of files.sort().entries()) {
  const payload = JSON.parse(readFileSync(join(inputDir, filename), 'utf8'));
  if (!payload.result?.architecture) {
    results.push({ filename, passed: false, issues: [payload.error || '缺少架构结果'] });
    continue;
  }
  try {
    const blueprint = compileCourseArchitecture({
      courseId: `spike-${index + 1}`,
      architecture: payload.result.architecture as CourseArchitecture,
      learner: payload.spec?.learnerPositioning ?? payload.blueprint?.learnerPositioning,
      modelVersion: payload.result.modelVersion,
      now: 1000 + index,
    });
    const validation = validateCourseBlueprint(blueprint);
    results.push({
      filename,
      topic: blueprint.topic,
      passed: validation.passed,
      chapterCount: blueprint.chapters.length,
      objectiveCount: blueprint.courseObjectives.length,
      issues: validation.issues,
    });
  } catch (error) {
    results.push({ filename, passed: false, issues: [String(error)] });
  }
}

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.passed)) process.exitCode = 1;
