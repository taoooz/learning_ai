/** Prompt Lab 只允许在本地开发或显式开启时访问。 */
export function isPromptLabEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ENABLE_PROMPT_DEBUGGER === '1';
}
