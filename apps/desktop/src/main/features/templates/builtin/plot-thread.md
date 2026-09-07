---
template: plot-thread
name: 伏笔线
targetKind: plot-thread
targetRole: threads
fields:
  - { key: title, label: 标题, type: text, required: true }
  - { key: importance, label: 重要度, type: select, options: [main, sub], default: sub }
  - { key: status, label: 状态, type: select, options: [planted, advanced, resolved, abandoned], default: planted }
  - { key: plantedAt, label: 埋设章节, type: link, targetKind: chapter }
  - { key: mustNotRevealBefore, label: 最早揭露章节, type: link, targetKind: chapter }
---

# {{title}}

## 线索与真相

## 推进计划
