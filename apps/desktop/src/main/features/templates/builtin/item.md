---
template: item
name: 武器道具
targetKind: world
targetRole: world
fields:
  - { key: title, label: 名称, type: text, required: true }
  - { key: category, label: 分类, type: select, options: [武器, 物品], default: 物品 }
  - { key: owner, label: 持有者, type: link, targetKind: character }
  - { key: status, label: 状态, type: select, options: [active, archived], default: active }
---

# {{title}}

## 特征与用途

## 当前状态
