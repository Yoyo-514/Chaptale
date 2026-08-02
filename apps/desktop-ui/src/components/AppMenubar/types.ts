export interface AppMenubarItem {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export interface AppMenubarMenu {
  id: string;
  label: string;
  items: readonly AppMenubarItem[];
}
