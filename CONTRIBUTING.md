# 开发与发布

开发需要 Node.js 24 LTS，pnpm 版本由根目录 `package.json` 固定。

```sh
pnpm install --frozen-lockfile
pnpm install:electron
pnpm dev
```

`pnpm install` 不下载 Electron。首次安装或升级 Electron 后运行 `pnpm install:electron`，它调用当前锁定版本的官方 `install-electron` 入口，下载并校验本机平台的 Electron 二进制，已装好同一版本时直接返回。只构建文档或只跑 Node.js 检查时可以跳过这一步。

`pnpm dev` 的配置和默认数据位置在 `~/.chaptale-dev`，安装版在 `~/.chaptale`，两边的作品和模型配置互不影响。

用户手册用 VitePress 编写，源码在 `docs/`：

```sh
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

写功能说明前先核对当前界面和代码。`design-docs/` 记录的是设计和里程碑，其中有尚未实现的内容，手册不以它为依据。

## 提交前检查

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:release
pnpm docs:build
pnpm build
pnpm exec playwright test --config playwright.electron.config.ts
```

类型检查、构建和测试共用契约产物，要按上面的顺序运行。Electron 测试使用临时作品和独立用户目录，不需要模型凭据。每个用例启动一个独立的 Electron 实例，并行运行，本地 4 个 worker，CI 上 2 个。CI 的单元测试和 Electron 测试只在 Windows 上跑，用例里的快捷键也按 Windows 编写。

`pnpm --filter @chaptale/agent-host test:live*` 会调用真实模型，可能计费，只在需要真实模型验收时运行，配置放在被忽略的 `temp/`。

CI 在 PR、main 分支推送和手动触发时运行，分成三个并行的作业：Linux 上跑格式、文档构建、lint、类型检查和发布脚本测试，Windows 上一个作业跑单元测试，另一个构建后跑 Electron 测试。`scripts/ci-changes.mjs` 按改动的文件决定跑哪些：

- 只改了 Markdown、`docs/` 或 `LICENCE` 时，只跑 `format:check` 和 `docs:build`。
- 推送到 main 且改动涉及 `apps/desktop/`、`packages/`、`pnpm-lock.yaml`、`.github/` 或 `scripts/smoke-packaged.mjs` 时，三个作业通过后再在 Windows x64、Linux x64、macOS Intel 与 Apple Silicon 上分别打出解包目录，并用 `scripts/smoke-packaged.mjs` 启动应用，确认它能在临时用户目录里建好作品库。PR 不打包。
- 手动触发和发版不按改动筛选，全部检查都跑。

安装包只在推送版本标签时生成。失败截图和 trace 保留 7 天。Electron 测试运行的是开发分发版 Electron，所以安装、升级和打开已有作品还要在安装包上人工验收。

工作流里的 Actions 都固定到提交 SHA，Dependabot 每周检查更新。

## 数据兼容

`v0.2.0` 是首发基线：本机库 `library.sqlite` 结构第 4 版，作品库 `work.sqlite` 第 2 版，`.chaptale` 作品包格式 3。

- 改动两种库的结构时，在 `packages/storage` 对应的 `SchemaPlan.migrations` 末尾追加迁移，已有的 `create` 和迁移不改。升级机制见 [storage](./packages/storage/README.md)。
- 改动作品包格式时，`v0.2.0` 及之后版本导出的包要能继续导入。
- 发版前用上一版的数据目录和作品包验证升级与导入。

## 本机打包

```sh
pnpm dist:desktop:win
pnpm dist:desktop:mac
pnpm dist:desktop:linux
```

产物在 `apps/desktop/release/`。中文分词等原生依赖按构建机的系统和架构安装，所以尽量在目标系统和目标架构上构建。macOS 只打一种架构时，先在根目录运行 `pnpm build:desktop`，再到 `apps/desktop` 执行 `pnpm exec electron-builder --mac --arm64 --publish never`，Intel 把参数换成 `--x64`。

## 发布版本

1. 完成检查并提交到 `main`，保持工作树干净，`pnpm release` 会检查这一点。
2. 维护者运行 `pnpm release` 选择版本号。`bumpp` 按 `bump.config.ts` 同步根目录与 `apps/desktop/package.json` 的版本，然后提交、创建附注标签 `v<version>` 并推送。
3. 标签名必须是 `v<version>`，两处 `package.json` 的版本也要一致，`bump.config.ts` 和 CI 的 `check-release.mjs` 都会检查。手工发布时用 `git tag -a` 打附注标签，再单独推送这个标签。`git push --follow-tags` 只推送附注标签，遇到轻量标签会跳过且不报错。
4. Release workflow 校验标签，然后同时运行 CI 和构建四个平台／架构的安装包。
5. 两边都通过后，流程汇总安装包与 `SHA256SUMS.txt`，创建 GitHub Release 草稿。
6. 维护者下载安装包，检查首次启动，以及从上一版升级后已有作品能打开。草稿正文是自动生成的提交列表，发布前改写成给作者看的更新说明，附下载表；安装包未签名时写明各系统怎么打开。

重跑流程只更新尚未发布的草稿，已公开的 Release 保持原样。Git 标签由维护者推送，工作流不创建标签。

应用启动时查询 GitHub 的最新正式发布（`releases/latest`），发现新版就显示 Release 正文和下载页链接，下载与安装由作者自己完成。草稿一公开，已安装的旧版就会收到提醒，所以更新说明要在发布前改好。

## 签名与公证

目前没有签名证书，`v0.2.0` 发布的是未签名安装包。拿到证书后配置下面的仓库 Actions secrets，发布流程会用它们签名。签名结果要在真实系统上检查。

| 平台       | Secrets                                                    |
| ---------- | ---------------------------------------------------------- |
| Windows    | `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`                     |
| macOS      | `MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`                     |
| macOS 公证 | `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` |

`*_CSC_LINK` 填 electron-builder 支持的证书输入，例如 Base64 编码的证书。只有发布流程会传入这些凭据，PR 构建拿不到。证书、模型密钥和个人配置不要提交到仓库。

项目源代码采用 [Apache License 2.0](./LICENCE)，第三方依赖保留各自的许可。
