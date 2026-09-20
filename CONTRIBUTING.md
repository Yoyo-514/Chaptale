# 开发与发布

使用 Node.js 24 LTS 和根目录 `package.json` 固定的 pnpm 版本。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

## 提交前检查

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:release
pnpm build
pnpm exec playwright test --config playwright.electron.config.ts
```

类型检查、构建和测试共享契约产物，按顺序运行。Electron 测试使用临时作品与独立用户目录，不需要模型凭据。图形测试保持单 worker；当前操作快捷键与 CI 验收基于 Windows。

CI 在 PR、main 分支推送和手动触发时运行上述检查，再在 Windows x64、Linux x64、macOS Intel 与 Apple Silicon 上分别打包。失败截图和 trace 保留 7 天。测试运行的是开发分发版 Electron；安装包还应进行安装、启动与升级的人工验收。

Actions 已按官方最新稳定版本固定到提交 SHA，Dependabot 每周检查更新。

## 本机打包

```sh
pnpm dist:desktop:win
pnpm dist:desktop:mac
pnpm dist:desktop:linux
```

产物在 `apps/desktop/release/`。优先在目标系统及目标架构构建，以正确安装原生分词依赖。macOS 单架构构建可在 `apps/desktop` 中执行 `pnpm exec electron-builder --mac --arm64 --publish never`（先运行根目录 `pnpm build:desktop`）；Intel 使用 `--x64`。

## 发布版本

1. 更新根目录和 `apps/desktop/package.json` 的版本，保持一致。默认模型 User-Agent 会随桌面包版本更新。
2. 完成检查并提交，然后由维护者推送对应版本标签，例如 `v0.1.0`。
3. Release workflow 校验标签、运行 CI，构建四个平台/架构的安装包。
4. 流程汇总安装包与 `SHA256SUMS.txt`，创建 GitHub Release **草稿**。
5. 维护者下载安装包，检查签名、首次启动和已有作品打开，再完善说明并发布草稿。

重跑流程只更新未发布草稿；已公开的 Release 不会被覆盖。工作流不会创建或推送 Git 标签，也不提供应用内自动更新。

## 签名与公证

没有签名凭据时也能构建，但产物不会自动成为受系统信任的发行版。正式发布前应配置仓库 Actions secrets，并在真实系统检查签名结果：

| 平台       | Secrets                                                    |
| ---------- | ---------------------------------------------------------- |
| Windows    | `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`                     |
| macOS      | `MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`                     |
| macOS 公证 | `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` |

`*_CSC_LINK` 使用 electron-builder 支持的证书输入，例如 Base64 编码的证书。发布流程才传入这些凭据，PR 构建不使用。不要把证书、模型密钥或个人配置提交到仓库。

项目源代码采用 [Apache License 2.0](./LICENCE)，第三方依赖保留各自的许可。
