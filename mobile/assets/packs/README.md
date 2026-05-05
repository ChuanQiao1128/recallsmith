# Pack art

Drop pack-cover PNG files here, then register them in
`src/theme/packArt.ts` like:

```ts
import csharpPack from '../../assets/packs/csharp.png';

const PACK_IMAGES: Record<string, ImageSourcePropType> = {
  csharp: csharpPack,
};
```

Recommended size: ~400×580 (portrait), transparent background.
