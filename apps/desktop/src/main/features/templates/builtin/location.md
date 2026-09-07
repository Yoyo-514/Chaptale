---
template: location
name: 地点
targetKind: world
targetRole: world
fields:
  - { key: title, label: 名称, type: text, required: true }
  - { key: category, label: 分类, type: select, options: [地点], default: 地点 }
  - { key: relations, label: 相邻与隶属, type: relations, default: [] }
  - { key: status, label: 状态, type: select, options: [active, archived], default: active }
---

# {{title}}

## 环境与布局

## 历史与现状
