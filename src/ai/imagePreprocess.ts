/**
 * Image -> YOLO input tensor pipeline.
 *
 * Steps: (1) resize the photo so it fits inside 640x640 keeping aspect ratio
 * (expo-image-manipulator, JPEG output), (2) decode JPEG pixels with jpeg-js,
 * (3) place pixels into a 640x640 letterbox canvas padded with grey (114),
 * normalized to 0..1, planar CHW Float32 — exactly what YOLOv8 TFLite expects.
 * Step (3) is pure and unit-tested; steps (1)-(2) run on device.
 */
import { computeLetterbox, MODEL_INPUT_SIZE, type LetterboxInfo } from './yoloPostprocess';

export interface RgbImage {
  width: number;
  height: number;
  /** RGBA or RGB bytes, row-major. */
  data: Uint8Array;
  channels: 3 | 4;
}

/** Build the [1,3,640,640] float tensor from a resized (fit-inside) image. */
export function buildInputTensor(image: RgbImage, letterbox: LetterboxInfo): Float32Array {
  const size = MODEL_INPUT_SIZE;
  const tensor = new Float32Array(3 * size * size);
  const padValue = 114 / 255;
  tensor.fill(padValue);

  const resizedW = Math.round(letterbox.origWidth * letterbox.scale);
  const resizedH = Math.round(letterbox.origHeight * letterbox.scale);
  const padX = Math.round(letterbox.padX);
  const padY = Math.round(letterbox.padY);

  // The provided image pixels are expected to already be the resized image
  // (resizedW x resizedH). We sample nearest-neighbour if sizes differ.
  for (let y = 0; y < resizedH; y++) {
    const srcY = Math.min(image.height - 1, Math.floor((y / resizedH) * image.height));
    for (let x = 0; x < resizedW; x++) {
      const srcX = Math.min(image.width - 1, Math.floor((x / resizedW) * image.width));
      const srcIdx = (srcY * image.width + srcX) * image.channels;
      const dstX = x + padX;
      const dstY = y + padY;
      if (dstX >= size || dstY >= size) continue;
      const plane = size * size;
      const dstIdx = dstY * size + dstX;
      tensor[0 * plane + dstIdx] = image.data[srcIdx] / 255;
      tensor[1 * plane + dstIdx] = image.data[srcIdx + 1] / 255;
      tensor[2 * plane + dstIdx] = image.data[srcIdx + 2] / 255;
    }
  }
  return tensor;
}

export { computeLetterbox };
