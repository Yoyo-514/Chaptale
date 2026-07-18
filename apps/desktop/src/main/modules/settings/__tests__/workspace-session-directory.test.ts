import { describe, expect, it } from 'vitest';

import { toWorkspaceSessionDirName } from '../workspace-session-directory';

describe('workspace-session-dir', () => {
  it('creates stable names with sanitized user-visible labels', () => {
    const first = toWorkspaceSessionDirName('E:/Stories/My:Project*?');
    const second = toWorkspaceSessionDirName('E:/Stories/My:Project*?');

    expect(first).toBe(second);
    expect(first).toMatch(/^My-Project---[a-f0-9]{12}$/);
  });

  it('keeps workspaces with the same label distinct by normalized absolute path hash', () => {
    const first = toWorkspaceSessionDirName('E:/A/Novel');
    const second = toWorkspaceSessionDirName('E:/B/Novel');

    expect(first).not.toBe(second);
    expect(first.startsWith('Novel-')).toBe(true);
    expect(second.startsWith('Novel-')).toBe(true);
  });
});
