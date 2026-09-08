import { nextTick } from 'vue';

import type { EditCommand } from '@chaptale/ipc-contract';

import { getDesktopApi } from './desktop-api';

/** 菜单会拿走焦点，执行原生编辑命令前恢复原控件与选区。 */
export function captureEditingTarget(target: EventTarget | null = document.activeElement) {
  const element = target instanceof HTMLElement ? target : null;
  const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null;
  const editable = input ? !input.readOnly && !input.disabled : Boolean(element?.isContentEditable);
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  const start = input?.selectionStart ?? null;
  const end = input?.selectionEnd ?? null;
  const text = input && start !== null && end !== null ? input.value.slice(start, end) : (selection?.toString() ?? '');
  return {
    editable,
    text,
    element,
    async execute(command: EditCommand) {
      await nextTick();
      if (element?.isConnected) element.focus({ preventScroll: true });
      if (input && start !== null && end !== null) input.setSelectionRange(start, end);
      else if (range && range.startContainer.isConnected) {
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      await getDesktopApi().editCommand(command);
    }
  };
}
