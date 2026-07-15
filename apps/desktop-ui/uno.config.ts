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
        // 使用 @iconify-json/mingcute 提供的图标数据
        // 用法: class="i-mingcute-send-plane-line"
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
      ring: 'var(--ring)',
      border: {
        DEFAULT: 'var(--border)',
        subtle: 'var(--border-subtle)',
        strong: 'var(--border-strong)'
      },
      card: {
        DEFAULT: 'var(--card)',
        foreground: 'var(--card-foreground)'
      },
      popover: {
        DEFAULT: 'var(--popover)',
        foreground: 'var(--popover-foreground)'
      },
      surface: {
        DEFAULT: 'var(--surface)',
        elevated: 'var(--surface-elevated)',
        muted: 'var(--surface-muted)',
        acrylic: 'var(--surface-acrylic)',
        'acrylic-strong': 'var(--surface-acrylic-strong)',
        'acrylic-subtle': 'var(--surface-acrylic-subtle)'
      },
      primary: {
        DEFAULT: 'var(--primary)',
        hover: 'var(--primary-hover)',
        active: 'var(--primary-active)',
        foreground: 'var(--primary-foreground)',
        solid: 'var(--primary-solid)',
        'solid-hover': 'var(--primary-solid-hover)',
        'solid-foreground': 'var(--primary-solid-foreground)'
      },
      secondary: {
        DEFAULT: 'var(--secondary)',
        foreground: 'var(--secondary-foreground)'
      },
      muted: {
        DEFAULT: 'var(--muted)',
        foreground: 'var(--muted-foreground)'
      },
      accent: {
        DEFAULT: 'var(--accent)',
        foreground: 'var(--accent-foreground)',
        sakura: 'var(--accent-sakura)',
        'sakura-foreground': 'var(--accent-sakura-foreground)',
        mint: 'var(--accent-mint)',
        'mint-foreground': 'var(--accent-mint-foreground)'
      },
      destructive: {
        DEFAULT: 'var(--destructive)',
        foreground: 'var(--destructive-foreground)',
        background: 'var(--destructive-background)',
        'background-foreground': 'var(--destructive-background-foreground)'
      },
      input: {
        DEFAULT: 'var(--input)',
        background: 'var(--input-background)',
        border: 'var(--input-border)',
        foreground: 'var(--input-foreground)',
        placeholder: 'var(--input-placeholder)',
        focus: 'var(--input-focus-border)'
      },
      action: {
        DEFAULT: 'var(--action-background)',
        hover: 'var(--action-background-hover)',
        foreground: 'var(--action-foreground)'
      },
      titlebar: {
        DEFAULT: 'var(--titlebar)',
        border: 'var(--titlebar-border)',
        foreground: 'var(--titlebar-foreground)',
        'control-hover': 'var(--titlebar-control-hover)'
      },
      sidebar: {
        DEFAULT: 'var(--sidebar)',
        foreground: 'var(--sidebar-foreground)',
        primary: 'var(--sidebar-primary)',
        'primary-foreground': 'var(--sidebar-primary-foreground)',
        accent: 'var(--sidebar-accent)',
        'accent-foreground': 'var(--sidebar-accent-foreground)',
        border: 'var(--sidebar-border)',
        ring: 'var(--sidebar-ring)'
      },
      chart: {
        1: 'var(--chart-1)',
        2: 'var(--chart-2)',
        3: 'var(--chart-3)',
        4: 'var(--chart-4)',
        5: 'var(--chart-5)'
      },
      primary_dark: 'var(--primary-solid)'
    }
  }
});
