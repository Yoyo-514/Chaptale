export interface AppMenubarItem {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separatorBefore?: boolean;
  /**
   * 单选组里的当前项，渲染成一个勾。
   *
   * 勾位会占掉固定宽度，所以同一组里要么都写要么都不写——只给一部分项写，
   * 剩下的文字会缩进不齐。
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
