import nextConfig from 'eslint-config-next/core-web-vitals';

export default [
  {
    ignores: ['**/.next/**', '**/.worktrees/**', '**/node_modules/**', 'docs/**'],
  },
  ...nextConfig,
  {
    // eslint-config-next 16 启用了 React Compiler 规则；项目当前仍采用
    // 传统 Next/React 写法，先关闭会把既有合法运行时模式判为错误的规则。
    rules: {
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];
