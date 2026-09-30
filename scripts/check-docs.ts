// scripts/check-docs.ts — 轻量文档契约检查
// 目标：防止根 README 膨胀、CHANGELOG 超限、模块地图路径失效。
// 只做结构检查，不判断文档语义；语义由 review 和交接包维护。

import { existsSync, readFileSync } from 'node:fs';

const README_PATH = 'README.md';
const CHANGELOG_PATH = 'CHANGELOG.md';
const AGENTS_PATH = 'AGENTS.md';

const REQUIRED_README_SECTIONS = [
  '# AI Learning',
  '## 1. 产品快照',
  '## 2. 核心用户路径',
  '## 3. 模块地图',
  '## 4. 关键不变量',
  '## 5. 详细文档索引',
  '## 6. 开发与验证',
];

const README_MAX_LINES = 150;
const CHANGELOG_MAX_LINES = 50;

type Check = { name: string; passed: boolean; detail?: string };

function readLines(path: string): string[] {
  return readFileSync(path, 'utf8').split(/\r?\n/);
}

function pathExists(raw: string): boolean {
  const path = raw.trim();
  if (!path || path.startsWith('/') || path.includes('://')) return true;
  if (path.endsWith('/**')) return existsSync(path.slice(0, -3));
  if (path.endsWith('/*')) return existsSync(path.slice(0, -2));
  return existsSync(path);
}

function extractBacktickPaths(markdown: string): string[] {
  const withoutFencedCode = markdown.replace(/^```[\s\S]*?^```$/gm, '');
  return [...withoutFencedCode.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1].trim())
    .filter((value) => value.includes('/'));
}

const checks: Check[] = [];
const readme = readFileSync(README_PATH, 'utf8');
const readmeLines = readLines(README_PATH);
const changelogLines = readLines(CHANGELOG_PATH);
const agents = readFileSync(AGENTS_PATH, 'utf8');

checks.push({
  name: 'README 必需章节齐全',
  passed: REQUIRED_README_SECTIONS.every((section) => readme.includes(section)),
  detail: REQUIRED_README_SECTIONS.filter((section) => !readme.includes(section)).join('；'),
});

checks.push({
  name: `README 不超过 ${README_MAX_LINES} 行`,
  passed: readmeLines.length <= README_MAX_LINES,
  detail: `当前 ${readmeLines.length} 行`,
});

checks.push({
  name: `CHANGELOG 不超过 ${CHANGELOG_MAX_LINES} 行`,
  passed: changelogLines.length <= CHANGELOG_MAX_LINES,
  detail: `当前 ${changelogLines.length} 行`,
});

checks.push({
  name: 'AGENTS 包含文档回流规则',
  passed: agents.includes('### 5. 架构文档回流') && agents.includes('npm run docs:check'),
});

const paths = extractBacktickPaths(readme);
const invalidPaths = paths.filter((path) => !pathExists(path));
checks.push({
  name: 'README 引用的本地路径存在',
  passed: invalidPaths.length === 0,
  detail: invalidPaths.join('；'),
});

// Markdown 链接里的本地文档也必须存在；跳过 http(s)。
const markdownLinks = [...readme.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
const invalidLinks = markdownLinks
  .filter((href) => !href.startsWith('http') && !href.startsWith('#'))
  .filter((href) => !existsSync(decodeURIComponent(href.split('#')[0])));
checks.push({
  name: 'README 详细文档链接存在',
  passed: invalidLinks.length === 0,
  detail: invalidLinks.join('；'),
});

const failed = checks.filter((check) => !check.passed);
console.log(JSON.stringify({
  passed: failed.length === 0,
  checks,
  readmeLines: readmeLines.length,
  changelogLines: changelogLines.length,
  checkedPaths: paths.length,
}, null, 2));

if (failed.length > 0) process.exitCode = 1;
