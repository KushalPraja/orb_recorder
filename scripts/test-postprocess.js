const fs = require('fs');
const path = require('path');
const { processVideo } = require('../src/main/post-processor');

function parseArgs(argv) {
  const parsed = {};
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function printHelp() {
  console.log('Usage: npm run test:post -- --session <recordingDir> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --session <dir>     Session directory (required)');
  console.log('  --output <file>     Output file path');
  console.log('  --zoom <factor>     Zoom factor (default: 2.0)');
  console.log('  --duration <secs>   Zoom hold duration (default: 1.5)');
  console.log('');
  console.log('Example:');
  console.log('  npm run test:post -- --session "%USERPROFILE%\\Videos\\ScreenRecorder\\2026-02-17T13-20-00-000Z"');
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help || args.h) {
    printHelp();
    process.exit(0);
  }

  if (!args.session) {
    printHelp();
    process.exit(1);
  }

  const recordingDir = path.resolve(args.session);
  if (!fs.existsSync(recordingDir)) {
    console.error(`Session directory not found: ${recordingDir}`);
    process.exit(1);
  }

  const outputPath = args.output ? path.resolve(args.output) : undefined;
  const zoomFactor = args.zoom ? Number(args.zoom) : undefined;
  const zoomDuration = args.duration ? Number(args.duration) : undefined;

  console.log(`Processing: ${recordingDir}`);

  const result = await processVideo({
    recordingDir,
    outputPath,
    zoomFactor,
    zoomDuration,
    onProgress: (p) => {
      const pct = Number.isFinite(p.percent) ? String(p.percent).padStart(3, ' ') : '  ?';
      process.stdout.write(`\r  ${p.phase || 'Processing'} ${pct}%`);
    },
  });

  process.stdout.write('\n');
  console.log(`Done: ${result}`);
}

main().catch((err) => {
  process.stdout.write('\n');
  console.error('Failed:', err.message);
  process.exit(1);
});
