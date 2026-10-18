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
    nav: [{ text: 'GitHub', link: 'https://github.com/Yoyo-514/Chaptale' }],
    sidebar: [],
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
