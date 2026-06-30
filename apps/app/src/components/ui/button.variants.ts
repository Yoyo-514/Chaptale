import { cva } from 'class-variance-authority';
import styles from './button.module.scss';

/**
 * Button 组件的样式变体配置
 */
export const buttonVariants = cva(styles.buttonBase, {
  variants: {
    variant: {
      default: styles.variantDefault,
      destructive: styles.variantDestructive,
      outline: styles.variantOutline,
      secondary: styles.variantSecondary,
      ghost: styles.variantGhost,
      link: styles.variantLink
    },
    size: {
      default: styles.sizeDefault,
      sm: styles.sizeSm,
      lg: styles.sizeLg,
      icon: styles.sizeIcon
    }
  },
  defaultVariants: {
    variant: 'default',
    size: 'default'
  }
});
