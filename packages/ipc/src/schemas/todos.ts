import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

export const TodosGetArgsSchema = Type.Tuple([Type.String({ minLength: 1 })]);
export const TodosGetArgsValidator = Compile(TodosGetArgsSchema);
