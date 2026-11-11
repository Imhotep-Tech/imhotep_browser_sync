import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');
const zipPath = path.resolve(rootDir, 'imhotep-browser-sync.zip');

if (!fs.existsSync(distDir)) {
  console.error('Error: dist directory does not exist. Run "npm run build" first.');
  process.exit(1);
}

// Ensure old zip is removed if exists
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  const sizeKb = (archive.pointer() / 1024).toFixed(2);
  console.log(`Successfully packaged extension to ${zipPath} (${sizeKb} KB)`);
});

archive.on('error', (err) => {
  console.error('Packaging error:', err);
  process.exit(1);
});

archive.pipe(output);
archive.directory(distDir, false);
archive.finalize();
