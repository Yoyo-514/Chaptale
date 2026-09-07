---
template: character-minor
name: 次要角色卡
targetKind: character
targetRole: characters
fields:
  - { key: title, label: 姓名, type: text, required: true }
  - { key: aliases, label: 别名称呼, type: tags, default: [] }
  - { key: importance, label: 重要度, type: select, options: [main, secondary, minor, extra], default: secondary }
  - { key: relations, label: 关系, type: relations, default: [] }
  - { key: status, label: 状态, type: select, options: [active, archived], default: active }
---

# {{title}}

## 角色定位

## 当前状态
