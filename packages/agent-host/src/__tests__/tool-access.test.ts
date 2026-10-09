import { describe, it } from 'vitest';

import { toolBehaviors } from './fixtures/tool-behaviors.ts';

describe('原生工具授权', () => {
  for (const behavior of toolBehaviors) it(behavior.name, behavior.run);
});
