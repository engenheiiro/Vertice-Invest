import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const buildAssetsDirectory = path.dirname(fileURLToPath(import.meta.url));
const iconsDirectory = path.join(buildAssetsDirectory, 'icons');
const outputDirectory = path.resolve(buildAssetsDirectory, '..', 'public', 'icons');
const standardSource = path.join(iconsDirectory, 'icon-source.svg');
const maskableSource = path.join(iconsDirectory, 'icon-maskable-source.svg');

const standardIcons = [
  { size: 180, name: 'apple-touch-icon-v2.png' },
  { size: 192, name: 'icon-192-v2.png' },
  { size: 512, name: 'icon-512-v2.png' },
];

await Promise.all([
  ...standardIcons.map(({ size, name }) =>
    sharp(standardSource)
      .resize(size, size)
      .png()
      .toFile(path.join(outputDirectory, name)),
  ),
  sharp(maskableSource)
    .resize(512, 512)
    .png()
    .toFile(path.join(outputDirectory, 'icon-512-maskable-v2.png')),
]);

console.log('Ícones do app gerados em client/public/icons.');
