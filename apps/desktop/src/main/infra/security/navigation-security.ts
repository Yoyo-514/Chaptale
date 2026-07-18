const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * 约束 Renderer 导航不得越出可信入口：file 入口精确匹配协议、主机和路径，查询串/片段不作为文件身份；
 * 非 file 入口仅允许同源地址，避免普通导航扩大本地页面的权限边界。
 */
export function isTrustedRendererUrl(candidate: string, trustedEntryUrl: string) {
  try {
    const candidateUrl = new URL(candidate);
    const trustedUrl = new URL(trustedEntryUrl);

    if (trustedUrl.protocol === 'file:') {
      return (
        candidateUrl.protocol === 'file:' &&
        candidateUrl.host === trustedUrl.host &&
        candidateUrl.pathname === trustedUrl.pathname
      );
    }

    return candidateUrl.origin === trustedUrl.origin;
  } catch {
    return false;
  }
}

/** 仅将 http、https 与 mailto allowlist 视为外链，避免把 file 或 custom 协议交给操作系统处理。 */
export function isExternalUrl(candidate: string) {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(candidate).protocol);
  } catch {
    return false;
  }
}
