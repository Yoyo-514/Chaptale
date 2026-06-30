import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetTypography,
  presetWind4,
  transformerDirectives,
  transformerVariantGroup
} from 'unocss';

export default defineConfig({
  presets: [
    presetWind4(),
    presetAttributify(),
    presetIcons({
      extraProperties: {
        display: 'inline-block',
        width: '1em',
        height: '1em'
      },
      collections: {
        // 使用 @iconify-json/lucide 提供的图标数据
        // 用法: class="i-lucide-send"
      }
    }),
    presetTypography()
  ],
  transformers: [transformerDirectives(), transformerVariantGroup()],
  shortcuts: {
    'wh-full': 'w-full h-full',
    'flex-center': 'flex justify-center items-center',
    'flex-x-center': 'flex justify-center',
    'flex-y-center': 'flex items-center',
    'flex-x-start': 'flex items-center justify-start',
    'flex-x-between': 'flex items-center justify-between',
    'flex-x-end': 'flex items-center justify-end'
  },
  theme: {
    colors: {
      background: 'var(--background)',
      foreground: 'var(--foreground)',
      border: 'var(--border)',
      input: 'var(--input)',
      ring: 'var(--ring)',
      primary: {
        DEFAULT: 'var(--primary)',
        foreground: 'var(--primary-foreground)'
      },
      secondary: {
        DEFAULT: 'var(--secondary)',
        foreground: 'var(--secondary-foreground)'
      },
      accent: {
        DEFAULT: 'var(--accent)',
        foreground: 'var(--accent-foreground)'
      },
      destructive: 'var(--destructive)',
      primary_dark: '#003366',
      titlebar: {
        DEFAULT: 'var(--titlebar)',
        border: 'var(--titlebar-border)',
        foreground: 'var(--titlebar-foreground)'
      }
    }
  }
});
