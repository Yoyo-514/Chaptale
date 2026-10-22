import type { CloudErrorCode } from '../../../bridge/cloud-sync';
import type { CloudCredential, CloudProviderAdapter } from './providers/provider-port';

export type CloudFailure = { ok: false; code: CloudErrorCode; message: string };
export type CloudCredentialResult =
  | { ok: true; adapter: CloudProviderAdapter; credential: CloudCredential }
  | CloudFailure;
