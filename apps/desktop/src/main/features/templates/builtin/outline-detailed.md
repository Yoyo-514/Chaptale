---
template: outline-detailed
name: 细纲
targetKind: outline
targetRole: outline
fields:
  - { key: title, label: 标题, type: text, required: true }
  - { key: level, label: 层次, type: select, options: [rough, detailed], default: detailed }
  - { key: chapter, label: 所属章节, type: link, targetKind: chapter }
  - { key: status, label: 状态, type: select, options: [active, archived], default: active }
---

# {{title}}

## 场景与目标

## 因果与转折
