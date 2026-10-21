import {
  defineTool,
  createReadToolDefinition,
  createLsToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition
} from '@earendil-works/pi-coding-agent';
import { mkdir } from 'node:fs/promises';

import { builtinWritingInstructions } from '../instructions/builtin.ts';
import { HostModelConfiguration } from '../runtime/model-configuration.ts';
import { createHostModelRuntime } from '../runtime/model-runtime.ts';
import { HostApplication } from './host-application.ts';

/** 平台提供已解析的私有目录；Node 业务装配不依赖进程通信方式。 */
export interface HostBootstrapOptions {
  cwd: string;
  agentDir: string;
  configDir: string;
  sessionDir: string;
  settingsFile: string;
}

export async function createHostApplication(options: HostBootstrapOptions): Promise<HostApplication> {
  await Promise.all(
    [options.configDir, options.agentDir, options.sessionDir, options.cwd].map(directory =>
      mkdir(directory, { recursive: true })
    )
  );
  const runtime = await createHostModelRuntime({ configDir: options.configDir });
  return HostApplication.create({
    ...options,
    builtinInstructions: builtinWritingInstructions,
    modelRuntime: runtime,
    modelConfiguration: new HostModelConfiguration(options.configDir, runtime),
    // 作品写入随创作工具接入。只读工具仍逐次经过 HostApplication 的授权边界。
    tools: cwd => [
      defineTool(createReadToolDefinition(cwd)),
      defineTool(createLsToolDefinition(cwd)),
      defineTool(createFindToolDefinition(cwd)),
      defineTool(createGrepToolDefinition(cwd))
    ]
  });
}
