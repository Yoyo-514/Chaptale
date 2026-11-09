import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

export const ChooseDataDirectoryArgsValidator = Compile(Type.Tuple([Type.String({ minLength: 1 })]));
