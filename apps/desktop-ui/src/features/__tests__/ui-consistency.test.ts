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

function templateStyleValues(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const props = 'props' in node && Array.isArray(node.props) ? node.props : [];
  const values = props.flatMap(prop => {
    const name = prop.type === 6 ? prop.name : prop.arg?.content;
    const value = prop.type === 6 ? prop.value?.content : prop.exp?.content;
    return ['class', 'style'].includes(name) && typeof value === 'string' ? [value] : [];
  });
  const children = 'children' in node && Array.isArray(node.children) ? node.children : [];
  return [...values, ...children.flatMap(templateStyleValues)];
}

function undersizedFonts(source: string): string[] {
  // 根字号沿用浏览器的 16px；这里只检查明确的字号声明，不把间距、图标尺寸或正文算进去。
  return [...source.matchAll(/(?:font-size\s*:\s*|text-\[(?:length:)?)(\d*\.?\d+)(px|rem)\b/g)]
    .filter(([, size, unit]) => Number(size) * (unit === 'rem' ? 16 : 1) < 12)
    .map(([declaration]) => declaration);
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

  it('字号守卫识别 px 和 rem，忽略正文中的代码示例与布局尺寸', () => {
    const { descriptor } = parse(
      `<template><div class="text-[11px]" :class="{ 'text-[0.7rem]': active }" style="font-size: .65rem">
      <span class="text-xs">font-size: 10px; text-[9px]</span></div></template>`
    );
    expect(undersizedFonts(templateStyleValues(descriptor.template?.ast).join('\n'))).toEqual([
      'text-[11px',
      'text-[0.7rem',
      'font-size: .65rem'
    ]);
    expect(undersizedFonts('.caption { font-size: 0.75rem; } @apply text-[12px] gap-[8px];')).toEqual([]);
    expect(undersizedFonts('@apply text-[length:.6875rem];')).toEqual(['text-[length:.6875rem']);
  });

  it('通用组件、业务模板和独立样式不重新引入小于 12px 的文字', async () => {
    const violations: string[] = [];
    let scanned = 0;
    for (const directory of ['components', 'features', 'layouts', 'styles']) {
      const filenames = await readdir(path.join(root, directory), { recursive: true });
      for (const filename of filenames.filter(name => /\.(vue|s?css)$/.test(name))) {
        const file = path.join(root, directory, filename);
        const source = await readFile(file, 'utf8');
        scanned++;
        const { descriptor } = filename.endsWith('.vue') ? parse(source, { filename: file }) : { descriptor: null };
        const styles = descriptor
          ? [...descriptor.styles.map(style => style.content), ...templateStyleValues(descriptor.template?.ast)]
          : [source];
        for (const declaration of styles.flatMap(undersizedFonts)) {
          violations.push(`${directory}/${filename}: ${declaration}`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
