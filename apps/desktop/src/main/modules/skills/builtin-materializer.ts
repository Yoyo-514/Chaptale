import fs from 'node:fs';
import path from 'node:path';

import { builtinSkillSources } from './builtin';

/**
 * 把打包进 bundle 的内置 skills 物化到可重建缓存目录。
 *
 * pi 的 skill 加载与模型按需 read 都依赖真实文件路径，因此内置层必须落盘；
 * 每次启动全量重写：应用升级后内容自动同步，目录可随时删除重建。
 */
export function materializeBuiltinSkills(targetDir: string): void {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  for (const skill of builtinSkillSources) {
    fs.writeFileSync(path.join(targetDir, skill.fileName), skill.source, 'utf8');
  }
}
