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
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
};

export class TokenVault {
  constructor(private readonly storage: SafeStorageLike) {}

  seal(value: string): SealedSecret {
    if (this.storage.isEncryptionAvailable()) {
      return { encryption: 'encrypted', payload: this.storage.encryptString(value).toString('base64') };
    }

    return { encryption: 'plaintext', payload: Buffer.from(value, 'utf8').toString('base64') };
  }

  /** 读不出来就抛错：静默返回空串会让上层把“无法解密”当成“没有凭据”继续往下跑。 */
  open(sealed: SealedSecret): string {
    const raw = Buffer.from(sealed.payload, 'base64');

    if (sealed.encryption === 'plaintext') {
      return raw.toString('utf8');
    }

    if (!this.storage.isEncryptionAvailable()) {
      throw new Error('系统密钥环不可用，无法读取已加密的云同步凭据');
    }

    return this.storage.decryptString(raw);
  }
}
