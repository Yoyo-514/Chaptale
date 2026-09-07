---
template: scene-card
name: 场景卡
targetKind: scene-card
targetRole: outline
fields:
  - { key: title, label: 标题, type: text, required: true }
  - { key: chapter, label: 所属章节, type: link, targetKind: chapter }
  - { key: cast, label: 出场角色, type: tags, targetKind: character, default: [] }
  - { key: location, label: 地点, type: link, targetKind: world }
  - { key: threads, label: 相关伏笔, type: tags, targetKind: plot-thread, default: [] }
  - { key: goal, label: 场景目标, type: textarea }
  - { key: forbidden, label: 禁忌, type: tags, default: [] }
  - { key: mood, label: 情绪基调, type: text }
  - { key: lengthHint, label: 目标字数, type: number, default: 2000 }
  - { key: settled, label: 已结算, type: checkbox, default: false }
---

# {{title}}

## 场景节拍

## 转折与结束
