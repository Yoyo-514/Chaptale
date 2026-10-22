import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

export const WindowCompleteCloseArgsValidator = Compile(Type.Tuple([Type.Boolean()]));
const WindowZoomCommandSchema = Type.Union([Type.Literal('in'), Type.Literal('out'), Type.Literal('reset')]);
export type WindowZoomCommand = Static<typeof WindowZoomCommandSchema>;
export const WindowZoomArgsValidator = Compile(Type.Tuple([WindowZoomCommandSchema]));

export type WindowStateResult = {
  isMaximized: boolean;
};
