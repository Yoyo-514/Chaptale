import { describe, expect, it } from 'vitest';

import { TokenVault, type SafeStorageLike, type SealedSecret } from '../token-vault';

/** 内存实现：与 Electron `safeStorage` 同形的可逆变换，只为验证封装行为而非加密强度。 */
function createStorage(available: boolean, failDecrypt = false): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: value => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: encrypted => {
      if (failDecrypt) throw new Error('密钥环已变更');

      return encrypted.toString('utf8').replace(/^enc:/, '');
    }
  };
}

describe('云同步凭据封装', () => {
  it('加密可用时标记为 encrypted 并原样取回', () => {
    const vault = new TokenVault(createStorage(true));
    const sealed = vault.seal('refresh-token-abc');

    expect(sealed.encryption).toBe('encrypted');
    expect(sealed.payload).not.toContain('refresh-token-abc');
    expect(vault.open(sealed)).toBe('refresh-token-abc');
  });
  it('密钥环不可用时降级为明文并如实标注，仍可读回', () => {
    const vault = new TokenVault(createStorage(false));
    const sealed = vault.seal('refresh-token-abc');

    expect(sealed.encryption).toBe('plaintext');
    expect(vault.open(sealed)).toBe('refresh-token-abc');
  });
  it('已加密的凭据在密钥环缺失或变更时拒绝静默返回空值', () => {
    const sealed: SealedSecret = { encryption: 'encrypted', payload: Buffer.from('enc:x').toString('base64') };

    expect(() => new TokenVault(createStorage(false)).open(sealed)).toThrow('密钥环不可用');
    expect(() => new TokenVault(createStorage(true, true)).open(sealed)).toThrow('密钥环已变更');
  });
});
