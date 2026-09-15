import type { CloudErrorCode } from '@chaptale/ipc-contract';

import type { CloudCredential, CloudProviderAdapter } from './providers/provider-port';
import type { StoredCloudBinding } from './store';

export type CloudWorkspaceQuery =
  | { status: 'ready'; rootPath: string; id: string; title: string }
  | { status: 'none' }
  | { status: 'unidentified'; rootPath: string };

export type CloudFailure = { ok: false; code: CloudErrorCode; message: string };
export type CloudWorkspaceResult = { ok: true; workspace: CloudWorkspaceQuery & { status: 'ready' } } | CloudFailure;
export type CloudCredentialResult =
  | { ok: true; adapter: CloudProviderAdapter; credential: CloudCredential }
  | CloudFailure;
export type CloudTarget = {
  ok: true;
  adapter: CloudProviderAdapter;
  credential: CloudCredential;
  binding: StoredCloudBinding;
  workspace: CloudWorkspaceQuery & { status: 'ready' };
};
