import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

import { SCHEDULED_BACKUP_INTERVALS } from '../scheduled-backup';

export const ScheduledBackupUpdateArgsValidator = Compile(
  Type.Tuple([
    Type.Object(
      {
        enabled: Type.Optional(Type.Boolean()),
        intervalMinutes: Type.Optional(Type.Union(SCHEDULED_BACKUP_INTERVALS.map(value => Type.Literal(value))))
      },
      { additionalProperties: false }
    )
  ])
);
