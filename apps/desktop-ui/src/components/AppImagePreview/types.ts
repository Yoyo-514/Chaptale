export type AppImagePreviewItem = {
  id: string;
  alt: string;
  thumbnailSrc: string;
  loadOriginal: () => Promise<Blob>;
};
