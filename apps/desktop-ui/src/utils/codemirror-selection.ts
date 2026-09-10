/**
 * CodeMirror 选区背景的统一覆盖规则。
 *
 * 必须显式对齐 CodeMirror 内置规则的选择器层级：
 * 内置聚焦态规则写作
 * `&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground`（5 级类），
 * 且本项目主题未声明 `dark`，`&light` 模块在深色主题下依然生效。
 *
 * 因此只覆盖 `.cm-selectionBackground`（2 级）或 `&.cm-focused .cm-selectionBackground`（3 级）
 * 优先级都不够：编辑器聚焦选中时会露出内置浅紫 `#d7d4f0`，
 * 而 `::selection` 又把文字染成深色主题的近白色 —— 白字浅底，选中内容完全看不清。
 *
 * 这里比内置多一级（`&.cm-editor`），保证聚焦与失焦态都稳定使用主题变量，
 * 三种主题（浅色 / 暖色 / 深色）各自用自己的 `--selection-background` 与 `--selection-foreground`。
 */
export const selectionBackgroundTheme = {
  '.cm-selectionBackground': { backgroundColor: 'var(--selection-background)' },
  '&.cm-editor .cm-scroller .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--selection-background)'
  },
  '&.cm-editor.cm-focused .cm-scroller .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--selection-background)'
  }
};
