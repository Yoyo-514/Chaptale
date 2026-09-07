import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

export const WindowCompleteCloseArgsValidator = Compile(Type.Tuple([Type.Boolean()]));

export type WindowStateResult = {
  isMaximized: boolean;
};
