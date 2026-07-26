/** frontmatter 解析端口；具体解析器由接线层注入，业务模块不依赖供应商 SDK。 */
export type FrontmatterParser = (content: string) => {
  frontmatter: Record<string, unknown>;
  body: string;
};
