import type { EditorTab } from '@/features/editor';

export function describeSyncFile(tab: EditorTab) {
  if (tab.external) {
    return {
      label: tab.external.ok ? '版本冲突' : tab.external.code === 'not-found' ? '磁盘文件已删除' : '磁盘读取失败',
      detail: tab.saveError || (tab.external.ok ? '本地修改仍保留' : tab.external.message),
      issue: true
    };
  }
  if (tab.saveError) return { label: '保存失败', detail: tab.saveError, issue: true };
  if (tab.recoveryError) return { label: '恢复稿写入失败', detail: tab.recoveryError, issue: true };
  if (tab.error) return { label: '文件读取失败', detail: tab.error.message, issue: true };
  if (tab.saving) return { label: '正在保存', detail: '', issue: false };
  if (tab.dirty) return { label: '未保存', detail: '', issue: false };
  if (tab.status === 'loading') return { label: '正在读取', detail: '', issue: false };
  return {
    label: tab.notice === '已载入磁盘更新' ? '已载入外部更新' : '本地已保存',
    detail: '',
    issue: false
  };
}

export function localSyncSummary(rootPath: string | null, tabs: readonly EditorTab[]) {
  if (!rootPath) return { label: '未打开作品', error: false };
  const issues = tabs.filter(tab => describeSyncFile(tab).issue).length;
  if (issues) return { label: `${issues} 个文件待处理`, error: true };
  if (tabs.some(tab => tab.saving)) return { label: '正在保存到本地', error: false };
  if (tabs.some(tab => tab.dirty)) return { label: '等待本地保存', error: false };
  return { label: '本地已保存', error: false };
}
