export const workspaceViews = [
  { id: 'library', label: '资料库', icon: 'i-mingcute-grid-line' },
  { id: 'timeline', label: '故事时间线', icon: 'i-mingcute-time-line' },
  { id: 'relationships', label: '角色关系', icon: 'i-mingcute-share-2-line' }
] as const;
export type WorkspaceView = (typeof workspaceViews)[number]['id'];
