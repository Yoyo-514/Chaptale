export interface AppMenubarItem {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separatorBefore?: boolean;
  /**
   * 单选组里的当前项，渲染成一个勾。
   *
   * 勾位由菜单容器统一保留，勾选与普通命令的文字保持对齐。
   */
  checked?: boolean;
  /**
   * 子菜单项。给出后本项只作为展开入口，不再触发 select。
   * 只渲染一层：再深的层级不该由菜单栏承担。
   */
  items?: readonly AppMenubarItem[];
}

export interface AppMenubarMenu {
  id: string;
  label: string;
  items: readonly AppMenubarItem[];
}
