import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';

const root = path.resolve(import.meta.dirname, '../..');
function nativeFields(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const tag = 'tag' in node && typeof node.tag === 'string' ? node.tag : '';
  const fields = ['input', 'select', 'textarea'].includes(tag) ? [tag] : [];
  const children = 'children' in node && Array.isArray(node.children) ? node.children : [];
  return [...fields, ...children.flatMap(nativeFields)];
}

describe('UI 一致性约束', () => {
  it('识别嵌套原生字段，但不把转义文字当作控件', () => {
    const { descriptor } = parse(
      '<template><div><input /><section><select /><textarea /></section>&lt;input&gt;</div></template>'
    );
    expect(nativeFields(descriptor.template?.ast)).toEqual(['input', 'select', 'textarea']);
  });

  it('业务表单使用通用控件，保留底层组件和编辑器的原生实现', async () => {
    const violations: string[] = [];
    let scanned = 0;
    for (const directory of ['features', 'layouts']) {
      const filenames = await readdir(path.join(root, directory), { recursive: true });
      for (const filename of filenames.filter(name => name.endsWith('.vue'))) {
        const file = path.join(root, directory, filename);
        scanned++;
        const { descriptor } = parse(await readFile(file, 'utf8'), { filename: file });
        for (const tag of descriptor.template?.ast ? nativeFields(descriptor.template.ast) : []) {
          violations.push(`${directory}/${filename}: <${tag}>`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
