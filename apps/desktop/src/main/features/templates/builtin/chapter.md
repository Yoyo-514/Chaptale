---
template: chapter
name: 章节
targetKind: chapter
targetRole: manuscript
fields:
  - { key: title, label: 标题, type: text, required: true }
  - { key: order, label: 顺序, type: number, default: 1 }
  - { key: status, label: 状态, type: select, options: [draft, final, archived], default: draft }
---

# {{title}}
