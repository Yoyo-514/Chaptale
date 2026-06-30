import { FileSystemIconLoader } from "@iconify/utils/lib/loader/node-loaders";
import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetTypography,
  presetWebFonts,
  presetWind4,
  transformerDirectives,
  transformerVariantGroup,
} from "unocss";

import fs from "fs";

// 本地图标目录
const iconsDir = "./src/assets/icons";

// 读取本地图标目录，自动生成 safeList
const generateSafeList = () => {
  try {
    return fs
      .readdirSync(iconsDir)
      .filter((file) => file.endsWith(".svg"))
      .map((file) => `i-svg:${file.replace(".svg", "")}`);
  } catch (error) {
    console.error("Error reading icons directory:", error);
    return [];
  }
};

export default defineConfig({
  presets: [
    presetWind4(),
    presetAttributify(),
    presetIcons({
      // 额外属性
      extraProperties: {
        display: "inline-block",
        width: "1em",
        height: "1em",
      },
      // 图表集合
      collections: {
        // svg 是图标集合名称，使用 `i-svg:图标名` 调用
        svg: FileSystemIconLoader(iconsDir, (svg) => {
          // 如果 `fill` 没有定义，则添加 `fill="currentColor"`
          return svg.includes(`fill="`) ? svg : svg.replace(/^<svg /, '<svg fill="currentColor" ');
        }),
      },
    }),
    presetTypography(),
    presetWebFonts({
      // 使用 bunny.net CDN 替代 Google Fonts
      provider: "bunny",
      fonts: {
        sans: "DM Sans",
        serif: "DM Serif Display",
        mono: "DM Mono",
      },
    }),
  ],
  safelist: generateSafeList(),
  transformers: [transformerDirectives(), transformerVariantGroup()],
  // 自定义快捷类
  shortcuts: {
    "wh-full": "w-full h-full",
    "flex-center": "flex justify-center items-center",
    "flex-x-center": "flex justify-center",
    "flex-y-center": "flex items-center",
    "flex-x-start": "flex items-center justify-start",
    "flex-x-between": "flex items-center justify-between",
    "flex-x-end": "flex items-center justify-end",
  },
  theme: {
    colors: {
      primary: "#66CCFF",
      primary_dark: "#003366",
    },
    breakpoints: Object.fromEntries(
      [640, 768, 1024, 1280, 1536, 1920, 2560].map((size, index) => [
        ["sm", "md", "lg", "xl", "2xl", "3xl", "4xl"][index],
        `${size}px`,
      ])
    )
  },
});
