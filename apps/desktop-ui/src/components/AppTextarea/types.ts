/** auto 按内容增高，上限由调用方的 max-height 决定。 */
export type AppTextareaResize = 'none' | 'vertical' | 'auto';
export type AppTextareaSize = 'sm' | 'md' | 'lg';
export type AppTextareaVariant = 'default' | 'muted' | 'plain';

export type AppTextareaExpose = {
  focus: (options?: FocusOptions) => void;
  select: () => void;
  getElement: () => HTMLTextAreaElement | null;
};
