import { describe, expect, it } from 'vitest';

import { TokenVault, type SafeStorageLike, type SealedSecret } from '../token-vault';

/** 内存实现：与 Electron `safeStorage` 同形的可逆变换，只为验证封装行为而非加密强度。 */
function createStorage(available: boolean, failDecrypt = false): SafeStorageLike {
  return {
    isAsyncEncryptionAvailable: async () => available,
    encryptStringAsync: async value => Buffer.from(`enc:${value}`, 'utf8'),
    decryptStringAsync: async encrypted => {
      if (failDecrypt) throw new Error('密钥环已变更');

      return { result: encrypted.toString('utf8').replace(/^enc:/, '') };
    }
  };
}

describe('云同步凭据封装', () => {
  it('加密可用时标记为 encrypted 并原样取回', async () => {
    const vault = new TokenVault(createStorage(true));
    const sealed = await vault.seal('refresh-token-abc');

    expect(sealed.encryption).toBe('encrypted');
    expect(sealed.payload).not.toContain('refresh-token-abc');
    await expect(vault.open(sealed)).resolves.toBe('refresh-token-abc');
  });
  it('密钥环不可用时降级为明文并如实标注，仍可读回', async () => {
    const vault = new TokenVault(createStorage(false));
    const sealed = await vault.seal('refresh-token-abc');

    expect(sealed.encryption).toBe('plaintext');
    await expect(vault.open(sealed)).resolves.toBe('refresh-token-abc');
  });
  it('已加密的凭据在密钥环缺失或变更时拒绝静默返回空值', async () => {
    const sealed: SealedSecret = { encryption: 'encrypted', payload: Buffer.from('enc:x').toString('base64') };

    await expect(new TokenVault(createStorage(false)).open(sealed)).rejects.toThrow('密钥环不可用');
    await expect(new TokenVault(createStorage(true, true)).open(sealed)).rejects.toThrow('密钥环已变更');
  });
});
