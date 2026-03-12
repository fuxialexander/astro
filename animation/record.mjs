import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANIMATION_URL = `file://${path.resolve(__dirname, 'index.html')}`;

// Scene durations must match SCENE_DURATIONS in index.html
const SCENE_DURATIONS = [10000, 12000, 14000, 14000, 16000, 10000, 8000];
const TOTAL = SCENE_DURATIONS.reduce((a, b) => a + b, 0);
const RECORD_TIME = TOTAL + 3000;

// CSS viewport 1920x1080, deviceScaleFactor 2 → screenshots at 3840x2160 (native 4K)
const CSS_WIDTH = 1920;
const CSS_HEIGHT = 1080;
const FPS = 25;
const FRAME_INTERVAL = 1000 / FPS;
const TOTAL_FRAMES = Math.ceil(RECORD_TIME / FRAME_INTERVAL);

const framesDir = path.resolve(__dirname, 'frames');
if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true });
fs.mkdirSync(framesDir);

console.log(`Recording ${RECORD_TIME / 1000}s @ ${FPS}fps — ${TOTAL_FRAMES} frames — 4K (3840x2160)...`);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: CSS_WIDTH, height: CSS_HEIGHT },
  deviceScaleFactor: 2,
});

const page = await context.newPage();
await page.goto(ANIMATION_URL, { waitUntil: 'networkidle' });

// Hide UI controls and nav dots for clean recording
await page.addStyleTag({ content: '.vo-controls, .nav, .crop-guide { display: none !important; }' });
await page.waitForTimeout(500);

// Capture frames via screenshots (lossless PNG, no VP8 compression)
const startTime = Date.now();
for (let i = 0; i < TOTAL_FRAMES; i++) {
  const frameFile = path.join(framesDir, `frame_${String(i).padStart(5, '0')}.png`);
  await page.screenshot({ path: frameFile, type: 'png' });

  // Pace to real-time (account for screenshot overhead)
  const elapsed = Date.now() - startTime;
  const target = (i + 1) * FRAME_INTERVAL;
  const wait = target - elapsed;
  if (wait > 0) await page.waitForTimeout(wait);

  if (i % 100 === 0) {
    const pct = ((i / TOTAL_FRAMES) * 100).toFixed(0);
    console.log(`  ${pct}% (${i}/${TOTAL_FRAMES} frames)`);
  }
}

console.log('Frames captured. Closing browser...');
await context.close();
await browser.close();

// Compose frames into high-quality H.264 video with ffmpeg
const output = path.resolve(__dirname, 'animation_raw_4k.mp4');
console.log('Encoding video with ffmpeg...');
execSync(
  `ffmpeg -y -framerate ${FPS} -i "${framesDir}/frame_%05d.png" ` +
  `-c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p ` +
  `"${output}"`,
  { stdio: 'inherit' }
);

console.log(`Saved: ${output}`);

// Clean up frames
fs.rmSync(framesDir, { recursive: true });
console.log('Cleaned up frame images.');
