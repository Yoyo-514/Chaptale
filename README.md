<p align="center">
  <img src="docs/public/logo.png" alt="Chaptale" width="128" height="128" />
</p>

<h1 align="center">Chaptale</h1>

<p align="center">长篇创作工作台 · 章节编辑与 Agent 协作</p>

<p align="center">
  <a href="https://github.com/Yoyo-514/Chaptale/actions/workflows/ci.yml"><img src="https://github.com/Yoyo-514/Chaptale/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/Yoyo-514/Chaptale/releases/latest"><img src="https://img.shields.io/github/v/release/Yoyo-514/Chaptale" alt="GitHub Release" /></a>
  <a href="./LICENCE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache License 2.0" /></a>
  <a href="https://github.com/Yoyo-514/Chaptale/releases/latest"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-526d82" alt="Windows、macOS、Linux" /></a>
</p>

<p align="center">
  <a href="https://github.com/Yoyo-514/Chaptale/releases/latest">下载安装</a> ·
  <a href="https://chaptale.yoyo514.top/">使用手册</a> ·
  <a href="./CONTRIBUTING.md">开发与贡献</a> ·
  <a href="https://github.com/Yoyo-514/Chaptale/issues">问题反馈</a>
</p>

Chaptale 是写小说、剧本等长篇作品的桌面应用，支持 Windows、macOS 和 Linux。作品保存在你自己的电脑上，每部作品一个独立的 SQLite 库。接上自己的模型服务后，Agent 可以读着作品和你讨论，也可以提出修改，由你逐处接受、拒绝或手改，再写入正文。Agent 由 [pi](https://github.com/earendil-works/pi) SDK 驱动。

## 功能

| 功能           | 可以做什么                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 作品库         | 新建小说或剧本，切换、删除与恢复作品；导入导出 `.chaptale` 作品包，同一作品可另存副本或覆盖                                  |
| 文稿与资料     | 文稿、资料两棵目录树，自由建目录、拖动排序；多标签与左右并排；TXT／Markdown 编辑，单页跨章阅读，正文插图                     |
| 资料           | 给资料设类型、别名、标签和封面；图片、PDF 等参考文件可以直接放进资料树                                                       |
| 保存与历史     | 手动或自动保存，未保存的输入留作恢复草稿；按章查看历史、对比与恢复；作品内回收站                                             |
| 搜索与替换     | 文档内查找替换；全作品搜索与替换（`Ctrl+Shift+F`），可区分大小写、全词匹配、用正则，替换后可撤销                             |
| 导入导出       | 导入 Markdown／TXT 文件与目录；导出单章、分章或合并整本                                                                      |
| 事件与关系     | 在资料页记录事件和人物关系，按“查看到某一章”筛选；从本章提取；章节改过后按章核对                                             |
| Agent 会话     | 多会话、流式回复，运行中插话或排到稍后处理；编辑已发消息后分支重发；把选中的文字引用到对话；查看用量与上下文占用，压缩对话   |
| 修改模式       | 讨论（作品只读）、审阅（逐处接受、拒绝或手改）、直接修改                                                                     |
| 指令与写作要求 | 自定义 system／user／assistant 指令，保存成命名指令给新会话选用；每部作品可以写一份写作要求                                  |
| 工具与扩展     | Skills 和 MCP 服务，各分全局与作品两级；MCP 支持本机程序（stdio）和远程 HTTP 服务，含浏览器 OAuth 登录                       |
| 工具授权       | Agent 读取作品目录之外的文件、调用 MCP 工具前先征得同意，可选“仅此次”“本会话允许”或“为这部作品记住”                          |
| 检索           | Agent 按关键词查找正文、资料、事件和关系；接上 embedding 服务并建立索引后，还能按意思查找                                    |
| 备份           | 作品包带上正文与修订、资料文件、作品的 Skills 和会话历史；可定时备份到本机文件夹，也可上传到 Dropbox、OneDrive，需要时再恢复 |
| 界面           | 浅色、暖色、深色三套主题，专注模式，界面缩放；“帮助 → 快捷键一览…”列出全部快捷键                                             |

## 安装

在 [Releases](https://github.com/Yoyo-514/Chaptale/releases/latest) 下载对应的安装包：

| 系统                | 文件                                                                         |
| ------------------- | ---------------------------------------------------------------------------- |
| Windows x64         | `Chaptale-<版本>-win-x64.exe`                                                |
| macOS（Apple 芯片） | `Chaptale-<版本>-mac-arm64.dmg` 或 `.zip`                                    |
| macOS（Intel 芯片） | `Chaptale-<版本>-mac-x64.dmg` 或 `.zip`                                      |
| Linux x64           | `Chaptale-<版本>-linux-amd64.deb` 或 `Chaptale-<版本>-linux-x86_64.AppImage` |

Windows 安装包目前未签名，macOS 版没有 Developer ID 签名，也没做公证。下载后可用同一页的 `SHA256SUMS.txt` 核对文件。

- Windows：弹出 SmartScreen 提示时，点“更多信息”，再点“仍要运行”。
- macOS：打开 DMG，把 Chaptale 拖到“应用程序”。系统提示无法验证开发者时，到“系统设置 → 隐私与安全性”点“仍要打开”。
- Linux：用 AppImage 时先给它执行权限（`chmod +x`），再打开。

应用启动时会向 GitHub 查询最新发布，有新版就发通知，下载和安装由你自己完成。启动检查可以在“帮助 → 关于…”里关掉，“帮助 → 检查更新”随时可用。

## 开始使用

1. 第一次启动时选一个文件夹存放作品和会话历史。
2. 新建作品，填写名称并选择小说或剧本。
3. 新建文稿，或通过“文件 → 导入文稿与资料…”导入已有的 TXT／Markdown。按 `Ctrl+S` 保存，macOS 上是 `Cmd+S`。
4. 需要 Agent 时，在“会话 → 模型设置…”添加模型服务，再打开协作栏新建会话。

模型服务支持 **OpenAI Chat Completions、OpenAI Responses、Anthropic Messages、Google Generative AI** 四种接口，配置保存为 pi 原生的 `models.json`。能不能用取决于服务地址、凭据和接口的兼容程度。

想让 Agent 按意思查找作品内容，在“设置 → 检索”填一个 OpenAI 兼容的 embedding 服务，再为作品建立索引，步骤见[使用手册](https://chaptale.yoyo514.top/)。不设置时 Agent 按关键词查找。

## 数据存放

作品和会话历史在你选的数据文件夹里，建议位置是 `~/.chaptale/data`。之后可以在“设置 → 应用数据”更换，重启后生效。

```text
<数据文件夹>/
  library.sqlite          作品列表、恢复草稿、Agent 提出但还没接受的修改
  works/<作品 ID>/
    work.sqlite           正文、资料、修订、事件与关系
    files/                资料树里的图片和其他文件
    skills/、mcp.json     这部作品自己的 Skills 和 MCP 配置
    vectors.sqlite        按意思检索用的索引，可以重建
  sessions/<作品 ID>/     这部作品的会话记录（pi 的 JSONL 格式）
  sessions/unassigned/    不属于任何作品的会话
```

应用设置、模型配置、全局的 Skills 和 MCP 配置在 `~/.chaptale/`，不随数据文件夹移动。

模型服务和 embedding 服务的密钥保存在 `~/.chaptale/pi/config/` 的 `models.json`、`embedding.json` 里，没有加密，不要把这个目录同步或发给别人。Dropbox、OneDrive 的登录凭据经系统加密后保存。

会话内容和 Agent 读取的作品内容会发给你配置的模型服务。作品文字从你点“建立索引”起才会发给 embedding 服务，之后按意思查找时，查找的问题也会发过去。

## 备份

作品包：“文件 → 导出作品包…”把一部作品存成单个 `.chaptale` 文件，里面有正文与修订、资料文件、作品的 Skills 和这部作品的会话历史。导入时可以另存为副本，或覆盖原作品；恢复出来的会话历史只能查看。检索索引和 MCP 配置不在包里，换设备后需要重新建立和填写。

定时备份：在“设置 → 备份”打开并选一个本机文件夹。应用开着的时候每 10 分钟、30 分钟或 1 小时检查一次，作品有改动才存一份作品包，每部作品保留最近 10 份。状态栏的“备份”菜单里可以立即备份。

云端备份：在“设置 → 云端账户”登录 Dropbox 或 OneDrive 后，从状态栏的“备份”菜单或“文件”菜单上传当前作品；定时备份开着时会同时上传。恢复走“文件 → 从云端恢复…”，列表按作品分组，每份备份标出时间、电脑和所在账户。单个作品包的上限是 Dropbox 150 MB、OneDrive 250 MB。

## TODO

- [ ] 使用手册
- [ ] 资源可视化：人物卡片墙、关系图、时间线，资料树按类型和标签筛选
- [ ] EPUB 导出
- [ ] Agent 把任务委派给子会话
- [ ] 会话之间用链接互相引用
- [ ] 对话里 @ 文件、添加附件
- [ ] 图像生成
- [ ] 模型自动路由
- [ ] 第三方插件
- [ ] 作品包合并导入
- [ ] 应用内下载并安装更新
- [ ] 移动端

## 从源码运行

需要 **Node.js ≥ 24** 和根目录 `package.json` 固定的 pnpm 版本。

```sh
git clone https://github.com/Yoyo-514/Chaptale.git
cd Chaptale
pnpm install --frozen-lockfile
pnpm install:electron
pnpm dev
```

`pnpm dev` 的配置和数据在 `~/.chaptale-dev`，和安装版的 `~/.chaptale` 分开。

### 项目结构

| 目录                  | 职责                                                          |
| --------------------- | ------------------------------------------------------------- |
| `apps/desktop`        | Electron 主进程、preload，以及运行 Agent 与作品服务的业务进程 |
| `apps/desktop-ui`     | Vue 3 + Pinia 界面，CodeMirror 编辑器                         |
| `packages/agent-host` | pi SDK 接入：模型运行时、会话、工具授权、Skills、MCP 与检索   |
| `packages/creation`   | 作品业务、审阅规则与仓储接口                                  |
| `packages/storage`    | SQLite 结构与迁移、事务、仓储实现、全文索引与作品包           |
| `packages/contracts`  | 跨平台传输信封                                                |
| `packages/ui`         | 应用客户端                                                    |
| `docs`                | VitePress 使用手册，正在按新界面重写                          |
| `e2e`、`scripts`      | Electron Playwright 测试与发布脚本                            |

项目使用 TypeScript、pnpm workspace 和 Turborepo；单元测试用 Vitest，端到端测试用 Playwright 启动真实的 Electron。开发检查、打包和发布步骤见[开发与发布](./CONTRIBUTING.md)。

## 反馈

在应用里点“帮助 → 反馈问题…”，会打开预填了版本和系统信息的 [Issue](https://github.com/Yoyo-514/Chaptale/issues) 页面。请写上复现步骤和错误提示，并先去掉截图、日志里的密钥和不想公开的作品内容。

## 许可证

[Apache License 2.0](./LICENCE)。第三方依赖保留各自的许可证。
