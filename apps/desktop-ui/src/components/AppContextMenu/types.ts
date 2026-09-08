export type AppContextMenuItem = {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  items?: readonly AppContextMenuItem[];
};
