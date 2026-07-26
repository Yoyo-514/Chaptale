import duty from './builtin/product-duty.md?raw';

/**
 * 产品职责层：Chaptale 固定拼装的产品级纪律（工具使用、资产红线、输出纪律）。
 * 用户 SYSTEM.md 只能替换 persona 层，本层始终生效。正文见 builtin/product-duty.md。
 */
export const PRODUCT_DUTY = duty.replace(/\r\n/g, '\n').trim();
