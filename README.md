<p align="center">
  <img src="docs/public/logo.png" alt="Chaptale" width="128" height="128" />
</p>

<h1 align="center">Chaptale</h1>

<p align="center">长篇创作工作台 · 章节编辑与 Agent 协作</p>

<p align="center">
  <a href="https://github.com/Yoyo-514/Chaptale/actions/workflows/ci.yml"><img src="https://github.com/Yoyo-514/Chaptale/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/Yoyo-514/Chaptale/releases"><img src="https://img.shields.io/github/v/release/Yoyo-514/Chaptale" alt="GitHub Release" /></a>
  <a href="./LICENCE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache License 2.0" /></a>
  <a href="https://github.com/Yoyo-514/Chaptale/releases"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-526d82" alt="Windows、macOS、Linux" /></a>
</p>

<p align="center">
  <a href="https://github.com/Yoyo-514/Chaptale/releases">下载安装</a> ·
  <a href="./CONTRIBUTING.md">开发与贡献</a> ·
  <a href="https://github.com/Yoyo-514/Chaptale/issues">问题反馈</a>
</p>

Chaptale 是面向小说、剧本等长篇作品的桌面写作工具。作品保存在你选定的本机目录中，用 Markdown 编辑；需要时可以在侧边会话里与 Agent 讨论作品。Agent 由 [pi](https://github.com/earendil-works/pi) SDK 驱动。

项目正在从底层重建。资料库、关系图、时间线、模板、候选稿审阅等旧功能已经移除，会随新的数据模型重新交付。使用重要稿件前，请备份完整作品目录。

## 当前功能

| 功能       | 当前可以做什么                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------- |
| 章节编辑   | Markdown、多标签、面包屑跳转目录与标题、查找替换、字数统计、自动保存、外部修改冲突处理             |
| Agent 会话 | 多个独立会话、流式回复、取消、历史重开；Agent 可读取和搜索作品文件，每次调用工具前都需要你授权     |
| 指令与模式 | 自定义 system / user / assistant 指令；会话模式分为讨论、审阅、直接修改（当前 Agent 只有只读工具） |
| 长会话     | 上下文接近上限时自动压缩，总结按剧情进度、人物、设定、伏笔与文风整理                               |
| 备份       | 通过已配置的 Dropbox / OneDrive 手动保存和恢复作品归档                                             |

## 安装与开始使用

在 [Releases](https://github.com/Yoyo-514/Chaptale/releases) 下载对应安装包：

| 系统                        | 安装包                      |
| --------------------------- | --------------------------- |
| Windows x64                 | `.exe`                      |
| macOS Apple Silicon / Intel | 对应架构的 `.dmg` 或 `.zip` |
| Linux x64                   | `.deb` 或 `.AppImage`       |

1. 启动后新建作品，选择名称和存放目录。
2. 打开章节开始写作，使用 `Ctrl+S` 保存。
3. 需要 Agent 时，在「设置 → 模型」添加模型服务，再打开会话面板新建会话。

模型服务支持 **OpenAI Chat Completions、OpenAI Responses、Anthropic Messages、Google Generative AI** 接口，配置保存为 pi 原生的 `models.json`。可用性取决于服务地址、凭据和接口兼容程度。

## 数据与运行方式

- **作品文件**：正文和资料是作品目录里的 Markdown 文件。
- **会话**：会话记录以 pi 的 JSONL 格式保存在应用数据目录，不写入作品目录。
- **模型服务**：会话内容和 Agent 读取的文件会发送给你配置的模型服务。
- **云端备份**：登录并绑定位置后手动生成作品归档；可用服务取决于应用构建时的配置。

## 从源码运行

需要 **Node.js ≥ 24** 和根目录 `package.json` 固定的 pnpm 版本。

```sh
git clone https://github.com/Yoyo-514/Chaptale.git
cd Chaptale
pnpm install --frozen-lockfile
pnpm install:electron
pnpm dev
```

### 项目结构

| 目录                  | 职责                                                       |
| --------------------- | ---------------------------------------------------------- |
| `apps/desktop`        | Electron 主进程与 preload，负责文件、备份和 Agent 宿主进程 |
| `apps/desktop-ui`     | Vue 3 + Pinia 界面，CodeMirror 编辑器                      |
| `packages/agent-host` | pi SDK 接入：模型运行时、会话、工具授权与传输协议          |
| `packages/ipc`        | 进程间通信契约与校验                                       |
| `packages/shared`     | 共享类型与逻辑                                             |
| `docs`                | VitePress 使用手册（随新界面重写中）                       |

项目使用 TypeScript、pnpm workspace 和 Turborepo；单元测试使用 Vitest，桌面端到端测试通过 Playwright 启动真实 Electron。开发检查、安装包构建与发布步骤见[开发与发布](./CONTRIBUTING.md)。

## 反馈

提交 [Issue](https://github.com/Yoyo-514/Chaptale/issues) 时请附上应用版本、操作系统、复现步骤和错误提示；先移除截图及日志中的密钥和私人作品内容。

## 许可证

[Apache License 2.0](./LICENCE)。第三方依赖保留各自的许可证。
