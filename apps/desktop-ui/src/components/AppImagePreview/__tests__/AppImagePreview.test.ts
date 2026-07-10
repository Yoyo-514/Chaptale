import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AppImagePreview from '../AppImagePreview.vue';
import type { AppImagePreviewItem } from '../types';

function createItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `image-${index}`,
    alt: `图片 ${index + 1}`,
    thumbnailSrc: `data:image/png;base64,thumb-${index}`,
    loadOriginal: vi.fn(async () => new Blob([`image-${index}`], { type: 'image/png' }))
  })) satisfies AppImagePreviewItem[];
}

const rekaStubs = {
  DialogRoot: {
    props: ['open'],
    emits: ['update:open'],
    template: '<div v-if="open" class="dialog-root-stub"><slot /></div>'
  },
  DialogPortal: { template: '<div><slot /></div>' },
  DialogOverlay: { template: '<div class="dialog-overlay-stub" />' },
  DialogContent: { template: '<div class="dialog-content-stub"><slot /></div>' },
  DialogTitle: { template: '<div><slot /></div>' },
  DialogDescription: { template: '<div><slot /></div>' },
  VisuallyHidden: { template: '<div><slot /></div>' }
};

function mountPreview(items: AppImagePreviewItem[], removable = false) {
  return mount(AppImagePreview, {
    props: { items, removable },
    global: {
      stubs: rekaStubs
    }
  });
}

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => `blob:${Math.random()}`)
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn()
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AppImagePreview', () => {
  it('renders compact lazy thumbnails without opening the lightbox', () => {
    const items = createItems(9);
    const wrapper = mountPreview(items, true);

    expect(wrapper.findAll('.app-image-thumbnail-item')).toHaveLength(9);
    expect(wrapper.find('.app-image-thumbnail-image').attributes()).toMatchObject({
      loading: 'lazy',
      decoding: 'async'
    });
    expect(wrapper.findAll('.app-image-thumbnail-remove')).toHaveLength(9);
    expect(wrapper.find('.dialog-root-stub').exists()).toBe(false);
  });

  it('opens the lightbox at the clicked thumbnail and loads only that original', async () => {
    const items = createItems(3);
    const wrapper = mountPreview(items);

    await wrapper.findAll('.app-image-thumbnail-trigger')[1]!.trigger('click');
    await flushPromises();

    expect(items[0]!.loadOriginal).not.toHaveBeenCalled();
    expect(items[1]!.loadOriginal).toHaveBeenCalledTimes(1);
    expect(items[2]!.loadOriginal).not.toHaveBeenCalled();
    expect(wrapper.find('.app-image-lightbox-counter').text()).toBe('2 / 3');
    expect(wrapper.find('.app-image-lightbox-image').attributes('src')).toMatch(/^blob:/);
  });

  it('switches with nav buttons, arrow keys, and the filmstrip', async () => {
    const items = createItems(3);
    const wrapper = mountPreview(items);

    await wrapper.findAll('.app-image-thumbnail-trigger')[1]!.trigger('click');
    await flushPromises();

    await wrapper.find('[aria-label="下一张图片"]').trigger('click');
    await flushPromises();
    expect(items[2]!.loadOriginal).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(wrapper.find('.app-image-lightbox-counter').text()).toBe('3 / 3');

    await wrapper.find('.dialog-content-stub').trigger('keydown', { key: 'ArrowLeft' });
    await flushPromises();
    expect(items[1]!.loadOriginal).toHaveBeenCalledTimes(2);
    expect(wrapper.find('.app-image-lightbox-counter').text()).toBe('2 / 3');

    await wrapper.findAll('.app-image-lightbox-thumb')[0]!.trigger('click');
    await flushPromises();
    expect(items[0]!.loadOriginal).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.app-image-lightbox-counter').text()).toBe('1 / 3');
    expect(wrapper.find('.app-image-lightbox-thumb[data-active="true"]').exists()).toBe(true);
  });

  it('closes via the close button', async () => {
    const items = createItems(2);
    const wrapper = mountPreview(items);

    await wrapper.findAll('.app-image-thumbnail-trigger')[0]!.trigger('click');
    await flushPromises();
    expect(wrapper.find('.dialog-root-stub').exists()).toBe(true);

    await wrapper.find('[aria-label="关闭预览"]').trigger('click');
    expect(wrapper.find('.dialog-root-stub').exists()).toBe(false);
  });

  it('closes when the open index falls out of range after items shrink', async () => {
    const items = createItems(3);
    const wrapper = mountPreview(items);

    await wrapper.findAll('.app-image-thumbnail-trigger')[2]!.trigger('click');
    await flushPromises();
    expect(wrapper.find('.dialog-root-stub').exists()).toBe(true);

    await wrapper.setProps({ items: items.slice(0, 2) });
    expect(wrapper.find('.dialog-root-stub').exists()).toBe(false);
  });

  it('zooms the original with wheel, buttons, double click, and keyboard, resetting on switch', async () => {
    const items = createItems(2);
    const wrapper = mountPreview(items);

    await wrapper.findAll('.app-image-thumbnail-trigger')[0]!.trigger('click');
    await flushPromises();

    const imageStyle = () => wrapper.find('.app-image-lightbox-image').attributes('style') ?? '';
    expect(imageStyle()).toContain('scale(1)');

    await wrapper.find('.app-image-lightbox-viewport').trigger('wheel', { deltaY: -100 });
    expect(imageStyle()).toContain(`scale(${1.2})`);
    expect(wrapper.find('.app-image-lightbox-zoom-value').text()).toBe('120%');

    await wrapper.find('[aria-label="放大"]').trigger('click');
    expect(wrapper.find('.app-image-lightbox-zoom-value').text()).toBe(`${Math.round(1.2 * 1.25 * 100)}%`);

    await wrapper.find('[aria-label="缩小"]').trigger('click');
    expect(wrapper.find('.app-image-lightbox-zoom-value').text()).toBe('120%');

    await wrapper.find('[aria-label="重置缩放"]').trigger('click');
    expect(imageStyle()).toContain('scale(1)');

    await wrapper.find('.app-image-lightbox-image').trigger('dblclick');
    expect(imageStyle()).toContain('scale(2.5)');
    await wrapper.find('.app-image-lightbox-image').trigger('dblclick');
    expect(imageStyle()).toContain('scale(1)');

    await wrapper.find('.dialog-content-stub').trigger('keydown', { key: '+' });
    expect(imageStyle()).toContain(`scale(${1.25})`);
    await wrapper.find('.dialog-content-stub').trigger('keydown', { key: '0' });
    expect(imageStyle()).toContain('scale(1)');

    await wrapper.find('.app-image-lightbox-viewport').trigger('wheel', { deltaY: -100 });
    await wrapper.find('[aria-label="下一张图片"]').trigger('click');
    await flushPromises();
    expect(imageStyle()).toContain('scale(1)');
  });

  it('emits removal without opening the lightbox', async () => {
    const wrapper = mountPreview(createItems(2), true);

    await wrapper.findAll('.app-image-thumbnail-remove')[0]!.trigger('click');

    expect(wrapper.emitted('remove')).toEqual([['image-0']]);
    expect(wrapper.find('.dialog-root-stub').exists()).toBe(false);
  });
});
