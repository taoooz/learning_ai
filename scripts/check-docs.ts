// scripts/check-docs.ts — 轻量文档契约检查
// 目标：防止根 README 膨胀、CHANGELOG 超限、模块地图路径失效。
// 只做结构检查，不判断文档语义；语义由 review 和交接包维护。

import { existsSync, readFileSync } from 'node:fs';

const README_PATH = 'README.md';
const CHANGELOG_PATH = 'CHANGELOG.md';
const AGENTS_PATH = 'AGENTS.md';
const DOCS_README_PATH = 'docs/README.md';
const DOCS_HISTORY_README_PATH = 'docs/history/README.md';

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
const DOCS_README_MAX_LINES = 120;

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
const docsReadme = readFileSync(DOCS_README_PATH, 'utf8');
const docsReadmeLines = readLines(DOCS_README_PATH);

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

const requiredDocsReadmeSections = [
  '## 当前事实',
  '## 长期规格',
  '## 长期参考',
  '## 历史材料',
  '## 维护规则',
];
checks.push({
  name: 'docs README 必需分类齐全',
  passed: requiredDocsReadmeSections.every((section) => docsReadme.includes(section)),
  detail: requiredDocsReadmeSections.filter((section) => !docsReadme.includes(section)).join('；'),
});
checks.push({
  name: `docs README 不超过 ${DOCS_README_MAX_LINES} 行`,
  passed: docsReadmeLines.length <= DOCS_README_MAX_LINES,
  detail: `当前 ${docsReadmeLines.length} 行`,
});
checks.push({
  name: 'docs history README 存在',
  passed: existsSync(DOCS_HISTORY_README_PATH),
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
type MarkdownLink = { href: string; base: string };
const markdownLinks: MarkdownLink[] = [
  ...readme.matchAll(/\]\(([^)]+)\)/g),
].map((match) => ({ href: match[1], base: '.' }));
markdownLinks.push(
  ...[...docsReadme.matchAll(/\]\(([^)]+)\)/g)].map((match) => ({
    href: match[1],
    base: 'docs',
  })),
);
const invalidLinks = markdownLinks
  .filter(({ href }) => !href.startsWith('http') && !href.startsWith('#'))
  .filter(({ href, base }) => !existsSync(`${base}/${decodeURIComponent(href.split('#')[0])}`))
  .map(({ href, base }) => `${base}/${href}`);
checks.push({
  name: 'README 与 docs README 链接存在',
  passed: invalidLinks.length === 0,
  detail: invalidLinks.join('；'),
});

const failed = checks.filter((check) => !check.passed);
console.log(JSON.stringify({
  passed: failed.length === 0,
  checks,
  readmeLines: readmeLines.length,
  changelogLines: changelogLines.length,
  docsReadmeLines: docsReadmeLines.length,
  checkedPaths: paths.length,
}, null, 2));

if (failed.length > 0) process.exitCode = 1;
