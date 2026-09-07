import chapter from './chapter.md?raw';
import main from './character-main.md?raw';
import minor from './character-minor.md?raw';
import faction from './faction.md?raw';
import item from './item.md?raw';
import location from './location.md?raw';
import detailed from './outline-detailed.md?raw';
import rough from './outline-rough.md?raw';
import thread from './plot-thread.md?raw';
import power from './power-system.md?raw';
import scene from './scene-card.md?raw';
import world from './worldview.md?raw';
export const builtinTemplates = [
  chapter,
  main,
  minor,
  faction,
  item,
  location,
  detailed,
  rough,
  thread,
  power,
  scene,
  world
].map(source => source.replace(/\r\n/g, '\n'));
