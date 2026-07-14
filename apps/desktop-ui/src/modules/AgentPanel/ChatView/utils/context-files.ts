import type { ChatContextFile } from '@chaptale/shared';
import { unique } from 'radash';

export function mergeChatContextFiles(
  currentFiles: ChatContextFile[],
  incomingFiles: ChatContextFile[]
): ChatContextFile[] {
  return unique([...currentFiles, ...incomingFiles], file => file.path);
}

export function getDroppedContextFilePaths(files: File[], getPathForFile: (file: File) => string): string[] {
  return files.map(file => getPathForFile(file)).filter(path => path.length > 0);
}
