import dns from 'node:dns/promises';
import { isIP } from 'node:net';

/** 解析结果为一组 IP 时，任一命中私网即拒绝。 */
export type SsrfGuardOptions = {
  allowRanges: readonly string[];
};

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

/** IPv4 私网/保留段（含本机、链路本地、CGNAT 与元数据服务常见段）。 */
const BLOCKED_V4_RANGES: readonly [bigint, bigint][] = [
  ['0.0.0.0', '0.255.255.255'].map(toIpv4Int) as [bigint, bigint], // "this network"
  ['10.0.0.0', '10.255.255.255'].map(toIpv4Int) as [bigint, bigint], // 私网 A
  ['100.64.0.0', '100.127.255.255'].map(toIpv4Int) as [bigint, bigint], // CGNAT
  ['127.0.0.0', '127.255.255.255'].map(toIpv4Int) as [bigint, bigint], // 回环
  ['169.254.0.0', '169.254.255.255'].map(toIpv4Int) as [bigint, bigint], // 链路本地（含云元数据）
  ['172.16.0.0', '172.31.255.255'].map(toIpv4Int) as [bigint, bigint], // 私网 B
  ['192.168.0.0', '192.168.255.255'].map(toIpv4Int) as [bigint, bigint], // 私网 C
  ['192.0.0.0', '192.0.0.255'].map(toIpv4Int) as [bigint, bigint], // 协议保留
  ['198.18.0.0', '198.19.255.255'].map(toIpv4Int) as [bigint, bigint], // 基准测试
  ['224.0.0.0', '255.255.255.255'].map(toIpv4Int) as [bigint, bigint] // 组播+保留
];

/**
 * URL 级 SSRF 校验：scheme 白名单 + 主机名全量 DNS 解析后逐 IP 检查。
 *
 * 只做"发起请求前"的校验；重定向由 fetch-page 逐跳重新调用本方法，
 * 收窄 DNS rebinding 的攻击窗口（单用户桌面工具的威胁模型下足够）。
 */
export async function assertFetchableUrl(rawUrl: string, options: SsrfGuardOptions): Promise<URL> {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`无效的 URL：${rawUrl}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError(`仅支持 http/https 协议，收到：${url.protocol}`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  if (!hostname) {
    throw new SsrfError('URL 缺少主机名');
  }

  // 字面量 IP 直接检查；域名走 DNS 全量解析后逐个检查。
  const addresses = isIP(hostname) ? [hostname] : await resolveAll(hostname);
  const allowList = parseAllowRanges(options.allowRanges);

  for (const address of addresses) {
    if (!isBlockedAddress(address, allowList)) {
      continue;
    }

    throw new SsrfError(`目标解析到内网或保留地址，已拒绝：${hostname} (${address})`);
  }

  return url;
}

async function resolveAll(hostname: string): Promise<string[]> {
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    return records.map(record => record.address);
  } catch {
    throw new SsrfError(`域名解析失败：${hostname}`);
  }
}

function isBlockedAddress(address: string, allowList: readonly [bigint, bigint][]): boolean {
  const normalized = unwrapIpv6Mapped(address);

  if (isIP(normalized) === 6) {
    return isBlockedIpv6(normalized);
  }

  const value = toIpv4IntOrNull(normalized);

  if (value === null) {
    // 无法解析的地址一律视为不安全。
    return true;
  }

  const matched = BLOCKED_V4_RANGES.some(([start, end]) => value >= start && value <= end);

  if (!matched) {
    return false;
  }

  // 显式放行网段优先于内置封锁。
  return !allowList.some(([start, end]) => value >= start && value <= end);
}

function isBlockedIpv6(address: string): boolean {
  const expanded = expandIpv6(address);
  const zone = expanded.split('%')[0];

  // 回环、未指定、唯一本地、链路本地、IPv4 映射段全部封锁。
  return (
    zone === '0'.repeat(32) ||
    zone === `${'0'.repeat(31)}1` ||
    zone.startsWith('fc') ||
    zone.startsWith('fd') ||
    zone.startsWith('fe8') ||
    zone.startsWith('fe9') ||
    zone.startsWith('fea') ||
    zone.startsWith('feb') ||
    zone.startsWith('00000000000000000000ffff')
  );
}

/** ::ffff:x.x.x.x 映射地址解包为 IPv4 字符串，便于复用 v4 规则。 */
function unwrapIpv6Mapped(address: string): string {
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return match ? match[1] : address;
}

function toIpv4Int(address: string): bigint {
  const value = toIpv4IntOrNull(address);
  if (value === null) {
    throw new Error(`非 IPv4 地址：${address}`);
  }
  return value;
}

function toIpv4IntOrNull(address: string): bigint | null {
  if (isIP(address) !== 4) {
    return null;
  }

  const [a = 0, b = 0, c = 0, d = 0] = address.split('.').map(Number);
  return (BigInt(a) << 24n) | (BigInt(b) << 16n) | (BigInt(c) << 8n) | BigInt(d);
}

/** 解析 CIDR 白名单；非法条目忽略（配置错误不应让全部请求失败）。 */
function parseAllowRanges(ranges: readonly string[]): [bigint, bigint][] {
  const parsed: [bigint, bigint][] = [];

  for (const entry of ranges) {
    const [base, prefixText = '32'] = entry.split('/');
    const value = toIpv4IntOrNull(base.trim());

    if (value === null) {
      continue;
    }

    const prefix = Number(prefixText);

    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      continue;
    }

    const mask = prefix === 0 ? 0n : (0xffffffffn << BigInt(32 - prefix)) & 0xffffffffn;
    parsed.push([value & mask, value | (~mask & 0xffffffffn)]);
  }

  return parsed;
}

/** 将 IPv6 展开为 32 位十六进制串，便于前缀判断；解析失败返回原值（按封锁处理）。 */
function expandIpv6(address: string): string {
  const [head, tail = ''] = address.split('::');
  const headGroups = head ? head.split(':').filter(Boolean) : [];
  const tailGroups = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headGroups.length - tailGroups.length;

  if (missing < 0 || (!address.includes('::') && headGroups.length + tailGroups.length !== 8)) {
    return address;
  }

  const groups = [
    ...headGroups,
    ...Array.from({ length: address.includes('::') ? missing : 0 }, () => '0'),
    ...tailGroups
  ];

  return groups.map(group => group.padStart(4, '0').toLowerCase()).join('');
}
