---
template: worldview
name: 世界观总览
targetKind: world
targetRole: world
fields:
  - { key: title, label: 标题, type: text, required: true }
  - { key: category, label: 分类, type: select, options: [世界观, 势力, 能力, 武器, 地点, 物品], default: 世界观 }
  - { key: tags, label: 标签, type: tags, default: [] }
  - { key: status, label: 状态, type: select, options: [active, archived], default: active }
---

# {{title}}

## 基本规则

## 边界与禁忌
