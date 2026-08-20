const sharp = require('sharp')
const toIco = require('to-ico')
const fs = require('fs')
const path = require('path')

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <!-- Background circle -->
  <circle cx="100" cy="100" r="100" fill="#7CC9BA"/>

  <!-- Clock face -->
  <circle cx="115" cy="128" r="50" fill="none" stroke="white" stroke-width="7"/>
  <!-- Clock tick marks (12 positions) -->
  <line x1="115" y1="78" x2="115" y2="88" stroke="white" stroke-width="5.5" stroke-linecap="round"/>
  <line x1="139" y1="81" x2="135" y2="90" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
  <line x1="158" y1="104" x2="149" y2="108" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
  <line x1="165" y1="128" x2="155" y2="128" stroke="white" stroke-width="5.5" stroke-linecap="round"/>
  <line x1="158" y1="152" x2="149" y2="148" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
  <line x1="139" y1="175" x2="135" y2="166" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
  <line x1="115" y1="178" x2="115" y2="168" stroke="white" stroke-width="5.5" stroke-linecap="round"/>
  <line x1="91" y1="175" x2="95" y2="166" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
  <line x1="72" y1="152" x2="81" y2="148" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
  <line x1="65" y1="128" x2="75" y2="128" stroke="white" stroke-width="5.5" stroke-linecap="round"/>
  <line x1="72" y1="104" x2="81" y2="108" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
  <line x1="91" y1="81" x2="95" y2="90" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
  <!-- Clock hands (10:10 position) -->
  <line x1="115" y1="128" x2="92" y2="104" stroke="white" stroke-width="7" stroke-linecap="round"/>
  <line x1="115" y1="128" x2="138" y2="104" stroke="white" stroke-width="5.5" stroke-linecap="round"/>
  <!-- Center dot -->
  <circle cx="115" cy="128" r="5" fill="white"/>

  <!-- Paper plane: broad body, nose upper-right, tail lower-left -->
  <!-- Main upper body: nose -> upper-tail -> crease -->
  <polygon points="163,40 25,88 85,115" fill="white"/>
  <!-- Lower wing: upper-tail -> crease -> lower-tail -->
  <polygon points="25,88 85,115 35,165" fill="white"/>
  <!-- Fold crease line -->
  <line x1="25" y1="88" x2="85" y2="115" stroke="#7CC9BA" stroke-width="3"/>
</svg>`

async function main() {
  const buildDir = path.join(__dirname, '..', 'build')
  const resourcesDir = path.join(__dirname, '..', 'resources')

  // Generate PNG at 512x512 for build and resources
  const png512 = await sharp(Buffer.from(svgContent))
    .resize(512, 512)
    .png()
    .toBuffer()
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png512)
  fs.writeFileSync(path.join(resourcesDir, 'icon.png'), png512)
  console.log('✓ icon.png (512x512)')

  // Generate ICO with multiple sizes
  const icoSizes = [16, 32, 48, 64, 128, 256]
  const pngBuffers = await Promise.all(
    icoSizes.map((size) =>
      sharp(Buffer.from(svgContent)).resize(size, size).png().toBuffer()
    )
  )
  const icoBuffer = await toIco(pngBuffers)
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer)
  console.log('✓ icon.ico (16/32/48/64/128/256px)')

  console.log('\nDone! Icons updated.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
