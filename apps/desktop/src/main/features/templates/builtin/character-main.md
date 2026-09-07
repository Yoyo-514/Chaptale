---
template: character-main
name: 主要角色卡
targetKind: character
targetRole: characters
fields:
  - { key: title, label: 姓名, type: text, required: true }
  - { key: aliases, label: 别名称呼, type: tags, default: [] }
  - { key: importance, label: 重要度, type: select, options: [main, secondary, minor, extra], default: main }
  - { key: faction, label: 所属势力, type: link, targetKind: world }
  - { key: relations, label: 关系, type: relations, default: [] }
  - { key: status, label: 状态, type: select, options: [active, archived], default: active }
---

# {{title}}

## 一句话定位

## 外貌与特征

## 性格与说话方式

## 目标与动机

## 秘密与已知信息
