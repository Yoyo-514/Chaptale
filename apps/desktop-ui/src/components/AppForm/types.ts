export type AppFormFieldLayout = 'stacked' | 'inline';

export type AppFormFieldSpan = 1 | 2 | 'full';

export type AppFormGridColumns = 1 | 2 | 3 | 'responsive';

export type AppFormGap = 'sm' | 'md' | 'lg';

export type AppFormActionsAlign = 'start' | 'center' | 'end' | 'between';

export type AppFormControlAttrs = {
  id: string;
  disabled?: boolean;
  required?: boolean;
  'aria-required'?: 'true';
  'aria-invalid'?: 'true';
  'aria-describedby'?: string;
};
