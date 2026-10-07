import { readFile } from 'node:fs/promises';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCredential(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type === 'api_key') {
    return (
      (value.key === undefined || typeof value.key === 'string') &&
      (value.env === undefined ||
        (isRecord(value.env) && Object.values(value.env).every(entry => typeof entry === 'string')))
    );
  }
  return (
    value.type === 'oauth' &&
    typeof value.access === 'string' &&
    typeof value.refresh === 'string' &&
    typeof value.expires === 'number' &&
    Number.isFinite(value.expires)
  );
}

/** 原生可写凭据存储会容忍读取失败；装配前校验文件，不解析密钥或执行命令。 */
export async function validateAuthConfig(path: string): Promise<void> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return;
    // 原始错误可能携带完整路径，有意不附加 cause。
    // oxlint-disable-next-line eslint/preserve-caught-error
    throw new Error('无法读取应用 auth.json');
  }

  let value: unknown;
  try {
    value = JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch {
    // JSON 解析器可能在错误中带出密钥片段，不向调用方传播原始错误。
    throw new Error('应用 auth.json 不是有效的 JSON');
  }
  if (!isRecord(value) || !Object.values(value).every(isCredential)) {
    throw new Error('应用 auth.json 凭据格式无效');
  }
}
