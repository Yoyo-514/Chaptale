import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'Chaptale 使用手册',
  description: 'Chaptale 创作工作台的用户文档',
  cleanUrls: true,
  head: [['link', { rel: 'icon', href: '/logo.png' }]],
  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'Chaptale',
    sidebarMenuLabel: '目录',
    returnToTopLabel: '返回顶部',
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换浅色主题',
    darkModeSwitchTitle: '切换深色主题',
    skipToContentLabel: '跳到正文',
    docFooter: { prev: '上一页', next: '下一页' },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '没有找到相关内容',
            resetButtonTitle: '清空搜索',
            backButtonTitle: '返回',
            displayDetails: '显示详细结果',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭'
            }
          }
        }
      }
    },
    nav: [
      { text: '开始使用', link: '/guide/getting-started' },
      { text: '作品与编辑', link: '/guide/workspace' },
      { text: 'AI 协作', link: '/ai/workflow' },
      { text: '数据安全', link: '/data/backup' },
      { text: 'GitHub', link: 'https://github.com/Yoyo-514/Chaptale' }
    ],
    sidebar: [
      {
        text: '开始使用',
        items: [
          { text: '安装与第一部作品', link: '/guide/getting-started' },
          { text: '认识工作台', link: '/guide/interface' }
        ]
      },
      {
        text: '作品与写作',
        collapsed: false,
        items: [
          { text: '创建和管理作品', link: '/guide/workspace' },
          { text: '编辑章节', link: '/guide/editor' },
          { text: '搜索与定位', link: '/guide/search' }
        ]
      },
      {
        text: '故事资料',
        collapsed: false,
        items: [
          { text: '资料库与资产', link: '/guide/library' },
          { text: '故事时间线', link: '/guide/timeline' },
          { text: '角色关系', link: '/guide/relationships' },
          { text: '模板与场景卡', link: '/guide/templates' }
        ]
      },
      {
        text: 'AI 协作',
        collapsed: false,
        items: [
          { text: '选择合适的协作流程', link: '/ai/workflow' },
          { text: '配置模型', link: '/ai/models' },
          { text: 'Agent 对话', link: '/ai/chat' },
          { text: '组装写作参考', link: '/ai/references' },
          { text: '生成与处理候选稿', link: '/ai/candidates' },
          { text: '独立审查', link: '/ai/reviews' },
          { text: '章节结算', link: '/ai/settlement' },
          { text: '记忆与运行记录', link: '/ai/history' },
          { text: '专员、技能与模板', link: '/ai/content' }
        ]
      },
      {
        text: '数据与备份',
        collapsed: false,
        items: [
          { text: '文档版本与定稿', link: '/data/versions' },
          { text: '云端备份与恢复', link: '/data/backup' },
          { text: '文件、权限与隐私', link: '/data/security' }
        ]
      },
      {
        text: '速查与帮助',
        collapsed: false,
        items: [
          { text: '设置速查', link: '/reference/settings' },
          { text: '快捷键', link: '/reference/shortcuts' },
          { text: '术语表', link: '/reference/glossary' },
          { text: '常见问题', link: '/reference/faq' }
        ]
      }
    ],
    outline: { level: [2, 3], label: '本页目录' },
    editLink: {
      pattern: 'https://github.com/Yoyo-514/Chaptale/edit/main/docs/:path',
      text: '帮助改进本页'
    },
    footer: {
      message: '文档以 Chaptale 当前实现为准',
      copyright: 'Chaptale · Apache-2.0'
    }
  }
});
