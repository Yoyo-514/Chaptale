export type AppTextareaResize = 'none' | 'vertical';
export type AppTextareaSize = 'sm' | 'md' | 'lg';
export type AppTextareaVariant = 'default' | 'muted' | 'plain';

export type AppTextareaExpose = {
  focus: (options?: FocusOptions) => void;
  select: () => void;
  getElement: () => HTMLTextAreaElement | null;
};
