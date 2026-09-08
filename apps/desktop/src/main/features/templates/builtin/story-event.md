---
template: story-event
name: 故事事件
targetKind: timeline-event
targetRole: world
fields:
  - { key: title, label: 事件名称, type: text, required: true }
  - { key: order, label: 故事顺序, type: number }
  - { key: when, label: 故事时间, type: text }
  - { key: strand, label: 故事线, type: text }
  - { key: summary, label: 事件摘要, type: textarea }
  - { key: cast, label: 相关角色, type: tags, targetKind: character, default: [] }
  - { key: chapter, label: 关联章节, type: link, targetKind: chapter }
  - { key: location, label: 地点, type: link, targetKind: world }
  - { key: status, label: 状态, type: select, options: [planned, confirmed, archived], default: planned }
---

# {{title}}

## 起因

## 经过与结果

## 后续影响
