/**
 * 云同步凭据的加密封装。
 *
 * 与 API Key 明文落盘的旧惯例不同：云 token 泄了等于把整个网盘交出去，两者不该同规格。
 * safeStorage 在缺少密钥环的 Linux 桌面上会不可用，那种情况**如实上报降级**——
 * 凭据要落盘是作者的选择，但应用不能在这件事上撒谎。
 */
export type SealedSecret = {
  encryption: 'encrypted' | 'plaintext';
  /** base64；`plaintext` 时是原文的 base64，只为让文件形状统一。 */
  payload: string;
};

/** Electron `safeStorage` 的结构子集；测试注入内存实现，避免为框架边界打桩。 */
export type SafeStorageLike = {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string }>;
};

export class TokenVault {
  constructor(private readonly storage: SafeStorageLike) {}

  async seal(value: string): Promise<SealedSecret> {
    if (await this.storage.isAsyncEncryptionAvailable()) {
      return { encryption: 'encrypted', payload: (await this.storage.encryptStringAsync(value)).toString('base64') };
    }

    return { encryption: 'plaintext', payload: Buffer.from(value, 'utf8').toString('base64') };
  }

  /** 读不出来就抛错：静默返回空串会让上层把“无法解密”当成“没有凭据”继续往下跑。 */
  async open(sealed: SealedSecret): Promise<string> {
    const raw = Buffer.from(sealed.payload, 'base64');

    if (sealed.encryption === 'plaintext') {
      return raw.toString('utf8');
    }

    if (!(await this.storage.isAsyncEncryptionAvailable())) {
      throw new Error('系统密钥环不可用，无法读取已加密的云同步凭据');
    }

    return (await this.storage.decryptStringAsync(raw)).result;
  }
}
