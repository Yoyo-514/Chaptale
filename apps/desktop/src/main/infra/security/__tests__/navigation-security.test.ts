import { describe, expect, it } from 'vitest';

import { isExternalUrl, isTrustedRendererUrl } from '../navigation-security';

describe('navigation security', () => {
  it('trusts the configured development origin only', () => {
    const entry = 'http://127.0.0.1:5173';

    expect(isTrustedRendererUrl('http://127.0.0.1:5173/#/chat', entry)).toBe(true);
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/settings', entry)).toBe(true);
    expect(isTrustedRendererUrl('https://example.com', entry)).toBe(false);
    expect(isTrustedRendererUrl('http://localhost:5173', entry)).toBe(false);
  });

  it('trusts only the packaged renderer entry file', () => {
    const entry = 'file:///C:/Chaptale/resources/app.asar/dist/renderer/index.html';

    expect(isTrustedRendererUrl(`${entry}#/chat`, entry)).toBe(true);
    expect(isTrustedRendererUrl('file:///C:/Users/Test/other.html', entry)).toBe(false);
    expect(isTrustedRendererUrl('https://example.com', entry)).toBe(false);
  });

  it('allows only supported external link protocols', () => {
    expect(isExternalUrl('https://example.com')).toBe(true);
    expect(isExternalUrl('http://example.com')).toBe(true);
    expect(isExternalUrl('mailto:author@example.com')).toBe(true);
    expect(isExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isExternalUrl('file:///C:/secret.txt')).toBe(false);
  });
});
