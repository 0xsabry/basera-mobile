import { Asset } from 'expo-asset';
import type { CapturedImage, ImageSource } from './ImageSource';

export interface SampleDefinition {
  id: string;
  titleEn: string;
  titleAr: string;
  /** require()d bundled asset module id. */
  module: number;
  width: number;
  height: number;
}

/**
 * Bundled sample photos for development, demos and testing.
 * Provenance is recorded in assets/samples/README.md.
 * The require() calls must stay static for Metro.
 */
export const SAMPLES: SampleDefinition[] = [
  {
    id: 'street-bus',
    titleEn: 'Street scene — bus and people',
    titleAr: 'مشهد شارع — حافلة وأشخاص',
    module: require('../../assets/samples/street-bus.jpg'),
    width: 810,
    height: 1080,
  },
  {
    id: 'people-zidane',
    titleEn: 'Two people talking',
    titleAr: 'شخصان يتحدثان',
    module: require('../../assets/samples/people.jpg'),
    width: 1280,
    height: 720,
  },
  {
    id: 'text-english',
    titleEn: 'English text page',
    titleAr: 'صفحة نص بالإنجليزية',
    module: require('../../assets/samples/text-english.png'),
    width: 1200,
    height: 800,
  },
  {
    id: 'text-arabic',
    titleEn: 'Arabic text sign',
    titleAr: 'لافتة نص بالعربية',
    module: require('../../assets/samples/text-arabic.png'),
    width: 1200,
    height: 800,
  },
];

export class SampleImageSource implements ImageSource {
  readonly id: string;
  readonly kind = 'sample' as const;

  constructor(private readonly sample: SampleDefinition) {
    this.id = `sample-${sample.id}`;
  }

  get definition(): SampleDefinition {
    return this.sample;
  }

  async getImage(): Promise<CapturedImage> {
    const asset = Asset.fromModule(this.sample.module);
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    return {
      uri,
      width: asset.width ?? this.sample.width,
      height: asset.height ?? this.sample.height,
      sourceKind: 'sample',
    };
  }
}
