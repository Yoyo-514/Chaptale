import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createGenerator } from 'unocss';
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';

import unoConfig from '../../../uno.config';

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

/** 模板里写死的类名；动态绑定的类名由各组件自己的行为测试覆盖。 */
function staticClasses(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const props = 'props' in node && Array.isArray(node.props) ? node.props : [];
  const own = props.flatMap(prop =>
    prop.type === 6 && prop.name === 'class' && prop.value ? prop.value.content.split(/\s+/).filter(Boolean) : []
  );
  const children = 'children' in node && Array.isArray(node.children) ? node.children : [];
  return [...own, ...children.flatMap(staticClasses)];
}

/** 悬停提示的两种写错：图标按钮没包 AppTooltip；提示的触发节点又写了原生 title，悬停时会出现两个提示。 */
function tooltipIssues(node: unknown, parent = ''): string[] {
  if (!node || typeof node !== 'object') return [];
  const tag = 'tag' in node && typeof node.tag === 'string' ? node.tag : '';
  const props = 'props' in node && Array.isArray(node.props) ? node.props : [];
  const names = new Set(props.map(prop => (prop.type === 6 ? prop.name : prop.arg?.content)));
  const issues = [
    ...(tag === 'AppButton' && names.has('icon') && parent !== 'AppTooltip' ? ['图标按钮没有 AppTooltip'] : []),
    ...(parent === 'AppTooltip' && names.has('title') ? [`<${tag}> 同时有 AppTooltip 和 title`] : [])
  ];
  const children = 'children' in node && Array.isArray(node.children) ? node.children : [];
  return [...issues, ...children.flatMap(child => tooltipIssues(child, tag))];
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

  it('提示守卫识别没包提示的图标按钮和重复的原生 title', () => {
    const issues = (template: string) =>
      tooltipIssues(parse(`<template>${template}</template>`).descriptor.template?.ast);
    expect(issues('<AppTooltip text="删除"><AppButton icon aria-label="删除" /></AppTooltip>')).toEqual([]);
    expect(issues('<AppButton title="完整标题">保存</AppButton>')).toEqual([]);
    expect(issues('<div><AppButton icon aria-label="删除" /></div>')).toEqual(['图标按钮没有 AppTooltip']);
    expect(issues('<AppTooltip text="删除"><button :title="reason" /></AppTooltip>')).toEqual([
      '<button> 同时有 AppTooltip 和 title'
    ]);
  });

  it('图标按钮的名称由 AppTooltip 显示，提示的触发节点不再写原生 title', async () => {
    const issues: string[] = [];
    for (const directory of ['components', 'features', 'layouts']) {
      const filenames = await readdir(path.join(root, directory), { recursive: true });
      for (const filename of filenames.filter(name => name.endsWith('.vue'))) {
        const file = path.join(root, directory, filename);
        const { descriptor } = parse(await readFile(file, 'utf8'), { filename: file });
        issues.push(...tooltipIssues(descriptor.template?.ast).map(issue => `${directory}/${filename}: ${issue}`));
      }
    }
    expect(issues).toEqual([]);
  });

  it('只收集模板里写死的类名', () => {
    const { descriptor } = parse(
      '<template><div class="card  card-title" :class="{ active }"><span class="i-mingcute-add-line" /></div></template>'
    );
    expect(staticClasses(descriptor.template?.ast)).toEqual(['card', 'card-title', 'i-mingcute-add-line']);
  });

  it('业务模板里写死的类名都有样式：来自某个样式块，或是 UnoCSS 工具类', async () => {
    const defined = new Set<string>();
    const used = new Map<string, string>();
    for (const directory of ['components', 'features', 'layouts', 'styles']) {
      const filenames = await readdir(path.join(root, directory), { recursive: true });
      for (const filename of filenames.filter(name => /\.(vue|s?css)$/.test(name))) {
        const file = path.join(root, directory, filename);
        const source = await readFile(file, 'utf8');
        const { descriptor } = filename.endsWith('.vue') ? parse(source, { filename: file }) : { descriptor: null };
        const styles = descriptor ? descriptor.styles.map(style => style.content) : [source];
        for (const [, name] of styles.join('\n').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(name!);
        if (directory === 'styles') continue;
        for (const name of staticClasses(descriptor?.template?.ast)) {
          if (!used.has(name)) used.set(name, `${directory}/${filename}`);
        }
      }
    }
    const candidates = [...used.keys()].filter(name => !defined.has(name));
    const { matched } = await (await createGenerator(unoConfig)).generate(candidates.join(' '), { preflights: false });
    expect(used.size).toBeGreaterThan(0);
    expect(candidates.filter(name => !matched.has(name)).map(name => `${used.get(name)}: ${name}`)).toEqual([]);
  });
});
