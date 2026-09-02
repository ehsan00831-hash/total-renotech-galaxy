#!/usr/bin/env node
/**
 * Generate social preview image (1200×630) for OpenGraph
 * Uses TotalRÊNOTECH brand colors and logo
 */
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);

const BRAND_BLUE = '#006EB8';
const BRAND_GOLD = '#D4AF37';
const BACKGROUND = '#0B0F14'; // black
const WHITE = '#FFFFFF';

const WIDTH = 1200;
const HEIGHT = 630;

// Create an SVG overlay with text
const textOverlay = `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <!-- Dark blue background -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${BACKGROUND}"/>

  <!-- Gold accent bar at top -->
  <rect width="${WIDTH}" height="6" fill="${BRAND_GOLD}"/>

  <!-- Main content area -->
  <g>
    <!-- Title -->
    <text x="60" y="220" font-family="Arial, sans-serif" font-size="72" font-weight="bold" fill="${WHITE}" letter-spacing="-1">
      TotalRÊNOTECH
    </text>

    <!-- Subtitle -->
    <text x="60" y="290" font-family="Arial, sans-serif" font-size="48" fill="${BRAND_GOLD}" font-weight="600">
      Operations
    </text>

    <!-- Description -->
    <text x="60" y="380" font-family="Arial, sans-serif" font-size="28" fill="${WHITE}" opacity="0.9">
      Work planning and operations management
    </text>

    <!-- Small accent line -->
    <line x1="60" y1="420" x2="180" y2="420" stroke="${BRAND_GOLD}" stroke-width="4"/>
  </g>
</svg>
`;

async function generatePreview() {
  try {
    console.log('Generating 1200×630 social preview image...');

    // Create base image with background
    const base = Buffer.from(textOverlay);

    // Convert SVG to PNG
    await sharp(base)
      .png()
      .toFile(join(projectRoot, 'public', 'social-preview.png'));

    console.log('✓ Social preview image created at public/social-preview.png');
    console.log(`  Dimensions: ${WIDTH}×${HEIGHT}px`);
    console.log(`  Format: PNG`);
    console.log(`  URL: https://ops-roan.vercel.app/social-preview.png`);
  } catch (err) {
    console.error('Failed to generate social preview:', err);
    process.exit(1);
  }
}

generatePreview();
