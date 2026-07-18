import { inject, provide, type InjectionKey } from 'vue';

export type AppOverlayLayer = 'popover' | 'modal-control';

const appOverlayLayerKey: InjectionKey<AppOverlayLayer> = Symbol('app-overlay-layer');

export function provideOverlayLayer(layer: AppOverlayLayer): void {
  provide(appOverlayLayerKey, layer);
}

export function useOverlayLayer(): AppOverlayLayer {
  return inject(appOverlayLayerKey, 'popover');
}
