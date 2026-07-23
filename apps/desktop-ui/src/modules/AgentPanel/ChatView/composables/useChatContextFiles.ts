import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import type { ChatContextFile } from '@chaptale/shared';

import { useNotificationStore } from '@/stores/notification';

import { getDroppedContextFilePaths, mergeChatContextFiles } from '../utils/context-files';
import type { ChatState } from './chat-state';

type UseChatContextFilesOptions = {
  state: ChatState;
  getDesktopApiOrNotify: () => ChaptaleDesktopApi | undefined;
};

/** 输入框上下文文件：选择、拖拽与移除。 */
export function useChatContextFiles({ state, getDesktopApiOrNotify }: UseChatContextFilesOptions) {
  const notificationStore = useNotificationStore();

  function mergeContextFiles(files: ChatContextFile[]) {
    state.contextFiles = mergeChatContextFiles(state.contextFiles, files);
  }

  async function handleAddContextFiles() {
    if (state.isConnecting || state.isReplying) {
      return;
    }

    const desktopApi = getDesktopApiOrNotify();
    if (!desktopApi) {
      return;
    }

    const files = await desktopApi.agent.selectContextFiles();
    mergeContextFiles(files);
  }

  async function handleDropContextFiles(droppedFiles: File[]) {
    if (state.isConnecting || state.isReplying) {
      return;
    }

    const desktopApi = getDesktopApiOrNotify();
    if (!desktopApi) {
      return;
    }

    // 沙盒 renderer 拿不到 File.path，由 preload 的 webUtils 转换后再交给主进程校验。
    const paths = getDroppedContextFilePaths(droppedFiles, file => desktopApi.agent.getPathForFile(file));

    if (paths.length === 0) {
      return;
    }

    const inspected = await desktopApi.agent.inspectContextFiles(paths);

    if (inspected.length === 0) {
      notificationStore.error('拖入的文件类型暂不支持', '目前支持常见文本/代码文件与 png/jpg/webp/gif 图片');
      return;
    }

    if (inspected.length < paths.length) {
      notificationStore.info('部分文件未添加', '不支持的文件类型已自动跳过');
    }

    mergeContextFiles(inspected);
  }

  function handleRemoveContextFile(path: string) {
    state.contextFiles = state.contextFiles.filter(file => file.path !== path);
  }

  return { handleAddContextFiles, handleDropContextFiles, handleRemoveContextFile };
}
