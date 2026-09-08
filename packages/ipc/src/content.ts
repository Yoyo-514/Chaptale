import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

import {
  ContentHashSchema,
  WorkspaceRelativePathSchema,
  type ContentDocument,
  type ContentImportPreview,
  type ContentList
} from '@chaptale/shared';

const KindSchema = Type.Union([Type.Literal('persona'), Type.Literal('skill'), Type.Literal('template')]);
const ScopeSchema = Type.Union([Type.Literal('user'), Type.Literal('workspace')]);
const IdSchema = Type.String({ pattern: '^[a-z][a-z0-9-]{0,79}$' });
const MarkdownSchema = Type.String({ maxLength: 131072 });
const BundleTextSchema = Type.String({ minLength: 1, maxLength: 4 * 1024 * 1024 });
export const ContentContextSchema = Type.Object(
  {
    rootPath: Type.Optional(Type.String({ minLength: 1, maxLength: 32768 }))
  },
  { additionalProperties: false }
);
export const ContentRefSchema = Type.Object(
  {
    kind: KindSchema,
    id: IdSchema,
    source: Type.Union([Type.Literal('builtin'), ScopeSchema]),
    sourcePath: WorkspaceRelativePathSchema,
    hash: ContentHashSchema
  },
  { additionalProperties: false }
);
const ReadSchema = Type.Object(
  {
    ...ContentContextSchema.properties,
    ref: ContentRefSchema
  },
  { additionalProperties: false }
);
export const ContentSaveSchema = Type.Object(
  {
    ...ContentContextSchema.properties,
    kind: KindSchema,
    scope: ScopeSchema,
    id: IdSchema,
    markdown: MarkdownSchema,
    sourcePath: Type.Optional(WorkspaceRelativePathSchema),
    expectedHash: Type.Optional(ContentHashSchema)
  },
  { additionalProperties: false }
);
const ExportSchema = Type.Object(
  {
    ...ContentContextSchema.properties,
    refs: Type.Array(ContentRefSchema, { minItems: 1, maxItems: 50 })
  },
  { additionalProperties: false }
);
const BundleContextSchema = Type.Object(
  {
    ...ContentContextSchema.properties,
    scope: ScopeSchema,
    text: BundleTextSchema
  },
  { additionalProperties: false }
);
const ImportSchema = Type.Object(
  {
    ...BundleContextSchema.properties,
    selected: Type.Array(
      Type.Object(
        {
          kind: KindSchema,
          id: IdSchema,
          overwrite: Type.Optional(ContentRefSchema)
        },
        { additionalProperties: false }
      ),
      { minItems: 1, maxItems: 50 }
    )
  },
  { additionalProperties: false }
);
export const ContentBundleSchema = Type.Object(
  {
    format: Type.Literal('chaptale-content'),
    version: Type.Literal(1),
    entries: Type.Array(
      Type.Object(
        {
          kind: KindSchema,
          id: IdSchema,
          markdown: MarkdownSchema,
          hash: ContentHashSchema
        },
        { additionalProperties: false }
      ),
      { minItems: 1, maxItems: 50 }
    )
  },
  { additionalProperties: false }
);
export type ContentContext = Static<typeof ContentContextSchema>;
export type ContentReadArgs = Static<typeof ReadSchema>;
export type ContentSaveArgs = Static<typeof ContentSaveSchema>;
export type ContentExportArgs = Static<typeof ExportSchema>;
export type ContentPreviewArgs = Static<typeof BundleContextSchema>;
export type ContentImportArgs = Static<typeof ImportSchema>;
export type ContentBundle = Static<typeof ContentBundleSchema>;
export const ContentContextValidator = Compile(Type.Tuple([ContentContextSchema]));
export const ContentReadValidator = Compile(Type.Tuple([ReadSchema]));
export const ContentSaveValidator = Compile(Type.Tuple([ContentSaveSchema]));
export const ContentExportValidator = Compile(Type.Tuple([ExportSchema]));
export const ContentPreviewValidator = Compile(Type.Tuple([BundleContextSchema]));
export const ContentImportValidator = Compile(Type.Tuple([ImportSchema]));
export const ContentBundleValidator = Compile(ContentBundleSchema);
export const ContentBundleTextValidator = Compile(
  Type.Tuple([Type.Object({ text: BundleTextSchema }, { additionalProperties: false })])
);
export type ContentApi = {
  list: (args: ContentContext) => Promise<ContentList>;
  read: (args: ContentReadArgs) => Promise<ContentDocument>;
  save: (args: ContentSaveArgs) => Promise<ContentDocument>;
  archive: (args: ContentReadArgs) => Promise<void>;
  previewExport: (args: ContentExportArgs) => Promise<string>;
  saveExport: (args: { text: string }) => Promise<string | null>;
  previewImport: (args: ContentPreviewArgs) => Promise<ContentImportPreview>;
  import: (args: ContentImportArgs) => Promise<{ imported: string[]; errors: string[] }>;
};
