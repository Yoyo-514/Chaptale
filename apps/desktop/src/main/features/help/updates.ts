import type { AppRelease, AppUpdate, AppUpdateCheck, AppUpdateState } from '../../../bridge/help';
import type { SettingsService } from '../../core/settings/service';

const UPDATE_TIMEOUT_MS = 10_000;
const latestStableTag = /^v(\d+\.\d+\.\d+)$/;

type UpdateCheckerOptions = {
  currentVersion: string;
  repository: string;
  endpoint: string;
  request: (url: string, init: RequestInit) => Promise<Response>;
  settings: Pick<SettingsService, 'readSettings' | 'setKnownAppUpdate'>;
};

async function readLatestRelease({ endpoint, request }: UpdateCheckerOptions): Promise<AppRelease | null> {
  const signal = AbortSignal.timeout(UPDATE_TIMEOUT_MS);
  const timeoutMessage = '连接 GitHub 超时，请稍后重试。';
  const response = await request(endpoint, { signal, headers: { Accept: 'application/vnd.github+json' } }).catch(
    cause => {
      throw new Error(signal.aborted ? timeoutMessage : '连不上 GitHub，请检查网络或代理后重试。', { cause });
    }
  );
  // GitHub 的 latest 接口只返回正式发布；首个版本公开前会返回 404。
  if (response.status === 404) return null;
  if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
    throw new Error('GitHub 检查次数已达上限，请稍后重试。');
  }
  if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}，请稍后重试。`);

  const invalidRelease = 'GitHub 返回的发布信息格式不正确。';
  const value: unknown = await response.json().catch(cause => {
    throw new Error(signal.aborted ? timeoutMessage : invalidRelease, { cause });
  });
  if (!value || typeof value !== 'object' || !('tag_name' in value) || typeof value.tag_name !== 'string') {
    throw new Error(invalidRelease);
  }
  const version = latestStableTag.exec(value.tag_name)?.[1];
  const notes = 'body' in value ? (value.body ?? '') : '';
  if (!version || typeof notes !== 'string') throw new Error(invalidRelease);
  return { version, notes };
}

function isNewer(stableVersion: string, installedVersion: string): boolean {
  const [installed, prerelease] = installedVersion.split('-', 2);
  const parts = installed!.split('.').map(Number);
  for (const [index, part] of stableVersion.split('.').map(Number).entries()) {
    const delta = part - parts[index]!;
    if (delta !== 0) return delta > 0;
  }
  // 同一版本号的正式版比预览版新。
  return prerelease !== undefined;
}

export function createUpdateChecker(options: UpdateCheckerOptions) {
  const { settings, currentVersion, repository } = options;
  const toUpdate = (release: AppRelease): AppUpdate => ({
    ...release,
    downloadUrl: `${repository}/releases/tag/v${release.version}`
  });
  return {
    async getState(): Promise<AppUpdateState> {
      const { checkUpdatesOnStartup, knownAppUpdate } = await settings.readSettings();
      return {
        checkOnStartup: checkUpdatesOnStartup,
        available: knownAppUpdate && isNewer(knownAppUpdate.version, currentVersion) ? toUpdate(knownAppUpdate) : null
      };
    },
    async check(): Promise<AppUpdateCheck> {
      const release = await readLatestRelease(options);
      const next = release && isNewer(release.version, currentVersion) ? release : undefined;
      const { knownAppUpdate } = await settings.readSettings();
      const announce = knownAppUpdate?.version !== next?.version;
      if (announce || knownAppUpdate?.notes !== next?.notes) await settings.setKnownAppUpdate(next);
      if (next) return { kind: 'available', update: toUpdate(next), announce };
      return release ? { kind: 'current', version: currentVersion } : { kind: 'unpublished' };
    }
  };
}
