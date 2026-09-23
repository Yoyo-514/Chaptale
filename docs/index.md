---
layout: home

hero:
  name: Chaptale
  text: 长篇创作工作台
  tagline: 写章节，整理角色与设定，梳理故事时间线
  image:
    src: /logo.png
    alt: Chaptale 图标
  actions:
    - theme: brand
      text: 开始使用
      link: /guide/getting-started
    - theme: alt
      text: 了解 AI 协作
      link: /ai/workflow
    - theme: alt
      text: 下载安装
      link: https://github.com/Yoyo-514/Chaptale/releases
---

<div class="manual-home">

## 使用手册

这份手册介绍 Chaptale 当前已经实现的功能。第一次使用，可以先完成“创建作品 → 写下第一章 → 保存”；日常查阅时，用左侧目录或顶部搜索直接找到操作。

![Chaptale 工作台：作品目录、章节编辑器与 Agent 对话](/screenshots/workbench.png)

_工作台实机截图。正文编辑、资料管理和 AI 面板围绕当前作品展开。_

## 先读哪一部分

| 你的目标                       | 阅读入口                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| 安装应用，创建第一部作品       | [开始使用](/guide/getting-started) → [认识工作台](/guide/interface)                           |
| 继续写已有稿件，整理章节和资料 | [管理作品](/guide/workspace) → [编辑章节](/guide/editor) → [资料库](/guide/library)           |
| 梳理事件与人物                 | [故事时间线](/guide/timeline) · [角色关系](/guide/relationships) · [场景卡](/guide/templates) |
| 让 AI 帮忙构思、改稿或检查问题 | [协作流程](/ai/workflow) → [配置模型](/ai/models)                                             |
| 回看旧稿，备份或迁移作品       | [文档版本](/data/versions) · [备份与恢复](/data/backup)                                       |
| 查设置、快捷键或错误提示       | [设置速查](/reference/settings) · [快捷键](/reference/shortcuts) · [常见问题](/reference/faq) |

## 写作中的几个概念

**作品**是一整个本机目录，包含正文、资料和应用记录。**资产**是资料库对角色、设定、场景卡等结构化文件的统称；它们仍然可以作为 Markdown 文件打开。

**候选稿**是尚待处理的正文修改。生成后先查看差异，再决定接受哪些部分。**章节结算**则从写完的章节中整理摘要和事实，用来更新后续写作需要的资料。完整说明见[术语表](/reference/glossary)。

## 关于数据

不配置模型也能写作和管理资料。使用 AI 时，对话和相关参考会发送到所配置的模型服务；使用云端备份时，需要另外登录并绑定备份位置。

保存、文档版本和云端备份各有用途：[了解它们的区别](/data/versions#save-version-backup)。

</div>
