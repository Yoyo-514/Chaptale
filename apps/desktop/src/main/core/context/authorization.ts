import { promises as fs } from 'node:fs';

/** 授权端口：装配层注入实现，消费方不依赖具体注册表类。 */
export type ContextFileAuthorizationPort = {
  authorize(filePath: string): Promise<void>;
  isAuthorized(filePath: string): Promise<boolean>;
};

/**
 * 运行期上下文文件授权池：只有经 inspectFiles / selectFiles（用户拖入或对话框选择）确认过的
 * 路径才能被 resolve 注入模型或经 readImage(context-file) 读取原图，封堵「被攻陷 Renderer
 * 凭空指定任意路径」的注入面。授权以 realpath 为键：文件移动/删除后 realpath 变化即失效。
 */
export class ContextFileAuthorizationRegistry {
  private readonly authorized = new Set<string>();

  async authorize(filePath: string): Promise<void> {
    try {
      this.authorized.add(await fs.realpath(filePath));
    } catch {
      // 不存在的路径不入池；resolve 时同样无法通过 realpath 比对。
    }
  }

  async isAuthorized(filePath: string): Promise<boolean> {
    try {
      return this.authorized.has(await fs.realpath(filePath));
    } catch {
      return false;
    }
  }

  clear(): void {
    this.authorized.clear();
  }
}
