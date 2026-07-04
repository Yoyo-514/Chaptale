import { describe, expect, it } from 'vitest';

import { toErrorMessage } from '../utils/desktop-api';

describe('desktop-api helpers', () => {
  it('strips Electron IPC remote method prefix', () => {
    expect(toErrorMessage("Error invoking remote method 'models:list': Error: 403 blocked")).toBe('403 blocked');
  });

  it('formats unknown errors', () => {
    expect(toErrorMessage('plain error')).toBe('plain error');
  });
});
