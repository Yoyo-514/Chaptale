---
template: faction
name: 势力
targetKind: world
targetRole: world
fields:
  - { key: title, label: 名称, type: text, required: true }
  - { key: category, label: 分类, type: select, options: [世界观, 势力, 能力, 武器, 地点, 物品], default: 势力 }
  - { key: relations, label: 关系, type: relations, default: [] }
  - { key: status, label: 状态, type: select, options: [active, archived], default: active }
---

# {{title}}

## 目标与资源

## 组织与规则
