// 供接线层注入到 pi-free 模块的 frontmatter 解析端口；
// 统一经 integrations 导出，避免 app 层直接依赖 pi 包。
export { parseFrontmatter as piParseFrontmatter } from '@earendil-works/pi-coding-agent';
