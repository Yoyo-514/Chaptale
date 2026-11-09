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

Chaptale 是面向小说、剧本等长篇作品的桌面写作工具。应用统一管理作品库，每部作品独立保存在本机 SQLite 中；Agent 可以和你讨论作品，也可以提出修改，由你逐处审阅后再写入正式内容。Agent 由 [pi](https://github.com/earendil-works/pi) SDK 驱动。

项目仍在开发中，关系图、时间线、自动备份等功能尚未交付。写重要稿件时，请定期导出作品包。

## 当前功能

| 功能       | 当前可以做什么                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------ |
| 作品库     | 新建、切换、删除与恢复作品；导入导出 `.chaptale` 作品包，同一作品可另存副本或覆盖                |
| 文稿与资料 | 两棵自由目录树、多标签与并排、TXT／Markdown 编辑、单页跨章阅读、查找替换、正文插图、资料文件条目 |
| 保存与历史 | 手动或自动保存、恢复草稿、按章查看历史、对比与恢复、作品内回收站                                 |
| 导入导出   | 导入 Markdown／TXT 文件与目录；导出单章、分章或合并整本                                          |
| 事件与关系 | 在资料页记录事件和关系，按章查看进度；从本章提取；改稿后按章核对                                 |
| Agent 会话 | 多会话、流式回复、运行中插话、历史重开、会话内工具授权、用量与上下文占用、手动和自动压缩         |
| 修改模式   | 讨论（作品只读）、审阅（逐处接受、拒绝或手改）、直接修改；全部处理完后 Agent 继续任务            |
| 指令       | 自定义 system／user／assistant 指令，保存为命名指令供新会话选用                                  |

## 安装与开始使用

在 [Releases](https://github.com/Yoyo-514/Chaptale/releases) 下载对应安装包：

| 系统                        | 安装包                      |
| --------------------------- | --------------------------- |
| Windows x64                 | `.exe`                      |
| macOS Apple Silicon / Intel | 对应架构的 `.dmg` 或 `.zip` |
| Linux x64                   | `.deb` 或 `.AppImage`       |

1. 启动后新建作品，填写名称并选择小说或剧本。
2. 新建文稿或通过“文件 → 导入文稿与资料…”导入，用 `Ctrl+S` 保存。
3. 需要 Agent 时，在“会话 → 模型设置…”添加模型服务，再打开会话面板新建会话。

模型服务支持 **OpenAI Chat Completions、OpenAI Responses、Anthropic Messages、Google Generative AI** 接口，配置保存为 pi 原生的 `models.json`。可用性取决于服务地址、凭据和接口兼容程度。

## 数据与运行方式

- **作品**：首次启动时选择数据存放位置（默认 `~/.chaptale/data`），之后可在“设置 → 应用数据”更换，重启后生效。每部作品一个目录，含 `work.sqlite` 和资料文件。Agent 的修改在接受前保存在本机库，只属于来源会话。
- **会话与模型**：会话记录以 pi 的 JSONL 格式保存在数据目录的 `sessions/` 下，按作品分子目录，未归属的在 `sessions/unassigned/`。模型密钥写在 `~/.chaptale/pi/config/models.json` 中，未加密，不要把这个目录同步给他人。
- **模型服务**：会话内容和 Agent 读取的内容会发送给你配置的模型服务。
- **备份**：作品包是单个 `.chaptale` 文件，包含作品、修订和资料文件，不含会话。设置中可以登录 Dropbox／OneDrive，云端备份尚未交付。

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

| 目录                  | 职责                                              |
| --------------------- | ------------------------------------------------- |
| `apps/desktop`        | Electron 主进程、preload 与共用业务进程           |
| `apps/desktop-ui`     | Vue 3 + Pinia 界面，CodeMirror 编辑器             |
| `packages/agent-host` | pi SDK 接入：模型运行时、会话、工具授权与传输协议 |
| `packages/creation`   | 作品业务、审阅规则与仓储接口                      |
| `packages/storage`    | SQLite schema、事务、仓储实现与全文检索           |
| `packages/contracts`  | 跨平台传输信封                                    |
| `packages/ui`         | 应用客户端                                        |
| `docs`                | VitePress 使用手册（待编写）                      |

项目使用 TypeScript、pnpm workspace 和 Turborepo；单元测试使用 Vitest，桌面端到端测试通过 Playwright 启动真实 Electron。开发检查、安装包构建与发布步骤见[开发与发布](./CONTRIBUTING.md)。

## 反馈

提交 [Issue](https://github.com/Yoyo-514/Chaptale/issues) 时请附上应用版本、操作系统、复现步骤和错误提示；先移除截图及日志中的密钥和私人作品内容。

## 许可证

[Apache License 2.0](./LICENCE)。第三方依赖保留各自的许可证。
