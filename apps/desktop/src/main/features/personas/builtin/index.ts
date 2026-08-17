import characterReviewerSource from './character-reviewer.md?raw';
import companionSource from './companion.md?raw';
import continuityReviewerSource from './continuity-reviewer.md?raw';
import memoryDistillerSource from './memory-distiller.md?raw';
import styleReviewerSource from './style-reviewer.md?raw';

/** 构建期打进 bundle 的内置 persona 源文本；新增内置 persona 时在此登记。换行统一为 LF，避免 Windows 检出的 CRLF 渗入运行层。 */
export const builtinPersonaSources: readonly string[] = [
  characterReviewerSource.replace(/\r\n/g, '\n'),
  companionSource.replace(/\r\n/g, '\n'),
  continuityReviewerSource.replace(/\r\n/g, '\n'),
  memoryDistillerSource.replace(/\r\n/g, '\n'),
  styleReviewerSource.replace(/\r\n/g, '\n')
];

/**
 * 内置 companion 的正文，作为系统提示词的最终回退（例如用户用 enabled: false 停用了 companion）。
 * 这里只剔除 frontmatter，不引入完整解析器，保持 features 层轻量。
 */
export const builtinCompanionBody = companionSource
  .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  .replace(/\r\n/g, '\n')
  .trim();
