import { safeStorage } from 'electron';

import type { SafeStorageLike } from '../security/token-vault';

/**
 * Electron `safeStorage` 的结构适配。
 *
 * 不在这里判断可用性：`isAsyncEncryptionAvailable` 只有在应用就绪后才有意义，
 * 判断留给真正读写凭据的时点（`TokenVault` 内部），构造期不做结论。
 */
export function createSafeStorageCipher(): SafeStorageLike {
  return {
    isAsyncEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    encryptStringAsync: value => safeStorage.encryptStringAsync(value),
    decryptStringAsync: value => safeStorage.decryptStringAsync(value)
  };
}
