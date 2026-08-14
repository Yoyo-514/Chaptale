import { describe, expect, it } from 'vitest';

import { SsrfError, assertFetchableUrl } from '../fetch/ssrf-guard';

const NO_ALLOW: { allowRanges: readonly string[] } = { allowRanges: [] };

describe('assertFetchableUrl · scheme 与格式', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://example.com/file',
    'javascript:alert(1)',
    'data:text/html,hello',
    'gopher://example.com'
  ])('拒绝非 http(s) 协议：%s', async url => {
    await expect(assertFetchableUrl(url, NO_ALLOW)).rejects.toThrow(SsrfError);
  });

  it('无效 URL 报错', async () => {
    await expect(assertFetchableUrl('http://', NO_ALLOW)).rejects.toThrow(SsrfError);
  });
});

describe('assertFetchableUrl · IPv4 字面量矩阵', () => {
  it.each([
    'http://127.0.0.1/',
    'http://127.1.2.3/',
    'http://10.0.0.5/',
    'http://10.255.255.255/',
    'http://172.16.0.1/',
    'http://172.31.255.254/',
    'http://192.168.1.1/',
    'http://169.254.169.254/', // 云元数据
    'http://0.0.0.0/',
    'http://100.64.0.1/', // CGNAT
    'http://192.0.0.1/',
    'http://198.18.0.1/',
    'http://224.0.0.1/', // 组播
    'http://255.255.255.255/'
  ])('拒绝内网/保留地址：%s', async url => {
    await expect(assertFetchableUrl(url, NO_ALLOW)).rejects.toThrow(SsrfError);
  });

  it.each(['http://8.8.8.8/', 'http://1.1.1.1/', 'http://93.184.216.34/'])('放行公网地址：%s', async url => {
    await expect(assertFetchableUrl(url, NO_ALLOW)).resolves.toBeInstanceOf(URL);
  });
});

describe('assertFetchableUrl · IPv6 与映射地址', () => {
  it.each([
    'http://[::1]/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://[fd12::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:10.0.0.1]/'
  ])('拒绝 IPv6 内网/映射地址：%s', async url => {
    await expect(assertFetchableUrl(url, NO_ALLOW)).rejects.toThrow(SsrfError);
  });

  it('放行公网 IPv6', async () => {
    await expect(assertFetchableUrl('http://[2606:4700::1111]/', NO_ALLOW)).resolves.toBeInstanceOf(URL);
  });
});

describe('assertFetchableUrl · DNS 解析路径', () => {
  it('localhost 解析到 127.0.0.1 被拒绝', async () => {
    await expect(assertFetchableUrl('http://localhost:3000/', NO_ALLOW)).rejects.toThrow(SsrfError);
  });

  it('DNS 解析失败报错', async () => {
    await expect(assertFetchableUrl('http://nonexistent.invalid/', NO_ALLOW)).rejects.toThrow(SsrfError);
  });
});

describe('assertFetchableUrl · allowRanges 白名单', () => {
  const options = { allowRanges: ['10.1.0.0/16', '192.168.0.0/24'] };

  it.each(['http://10.1.2.3/', 'http://10.1.255.255/', 'http://192.168.0.10/'])('显式放行网段内地址：%s', async url => {
    await expect(assertFetchableUrl(url, options)).resolves.toBeInstanceOf(URL);
  });

  it.each(['http://10.2.0.1/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://172.16.0.1/'])(
    '网段外内网地址仍拒绝：%s',
    async url => {
      await expect(assertFetchableUrl(url, options)).rejects.toThrow(SsrfError);
    }
  );

  it('非法白名单条目被忽略（不崩溃）', async () => {
    const broken = { allowRanges: ['not-a-cidr', '10.0.0.0/99', '', '300.1.1.1/8'] };
    await expect(assertFetchableUrl('http://10.0.0.1/', broken)).rejects.toThrow(SsrfError);
  });
});
