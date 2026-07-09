import type { AppButtonSize, AppButtonVariant } from './AppButton.vue';

/** AppButton 支持的语义变体。视觉实现位于 AppButton.vue 的 SCSS 中。 */
export const appButtonVariants = [
  'primary',
  'secondary',
  'danger',
  'outline',
  'ghost',
  'link'
] as const satisfies readonly AppButtonVariant[];

/** AppButton 支持的外框尺寸。icon 只控制外框形态，不控制内部图标尺寸。 */
export const appButtonSizes = ['xs', 'sm', 'md', 'lg'] as const satisfies readonly AppButtonSize[];
