import { toolBehaviors } from './tool-behaviors.ts';

const results = [];
for (const behavior of toolBehaviors) {
  await behavior.run();
  results.push({ name: behavior.name, ok: true });
}
console.log(JSON.stringify({ platform: process.platform, node: process.version, results }));
