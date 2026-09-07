import type { AssetSnapshot, AssetLink } from '@chaptale/shared';

import type { SearchProviderInput, SearchProviderOutput } from '../memory/service';
import type { IndexSearchOptions, IndexSearchResult } from '../types';
import type { IndexReadyResult } from './service';

export type IndexWorkerOperations = {
  assets: { args: { cwd: string }; result: AssetSnapshot };
  link: { args: { cwd: string; link: string }; result: AssetLink };
  search: {
    args: { cwd: string; query: string; options: Omit<IndexSearchOptions, 'signal'> };
    result: IndexSearchResult[];
  };
  literal: { args: Omit<SearchProviderInput, 'signal'>; result: SearchProviderOutput };
  ready: { args: { cwd: string }; result: IndexReadyResult };
  invalidate: { args: { cwd: string; paths?: string[] }; result: void };
};
export type IndexWorkerRequest = {
  [K in keyof IndexWorkerOperations]: { id: number; method: K; args: IndexWorkerOperations[K]['args'] };
}[keyof IndexWorkerOperations];
export type IndexWorkerResponse = { id: number } & ({ ok: true; value: unknown } | { ok: false; error: string });
