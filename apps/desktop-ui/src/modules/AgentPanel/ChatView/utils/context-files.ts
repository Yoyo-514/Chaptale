import type { SelectedContextFile } from '@chaptale/ipc-contract';
import { unique } from 'radash';

export function mergeSelectedContextFiles(
  currentFiles: SelectedContextFile[],
  incomingFiles: SelectedContextFile[]
): SelectedContextFile[] {
  return unique([...currentFiles, ...incomingFiles], file => file.path);
}

export function getDroppedContextFilePaths(files: File[], getPathForFile: (file: File) => string): string[] {
  return files.map(file => getPathForFile(file)).filter(path => path.length > 0);
}
