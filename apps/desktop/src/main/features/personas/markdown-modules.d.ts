/** 允许主进程以 Vite `?raw` 方式把 builtin persona Markdown 打进 bundle，避免运行时 fs 路径依赖。 */
declare module '*.md?raw' {
  const content: string;
  export default content;
}
