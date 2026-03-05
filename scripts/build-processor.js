const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with code ${result.status}`);
  }
}

function commandExists(cmd) {
  const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: false });
  return probe.status === 0;
}

function resolvePythonCommand() {
  const candidates = process.platform === 'win32'
    ? ['py', 'python']
    : ['python3', 'python'];

  for (const candidate of candidates) {
    if (commandExists(candidate)) {
      return candidate;
    }
  }

  throw new Error('Python was not found on PATH. Install Python 3 to build the processor binary.');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function main() {
  const root = path.resolve(__dirname, '..');
  const processScript = path.join(root, 'scripts', 'process.py');
  const buildRoot = path.join(root, '.pybuild');
  const distDir = path.join(buildRoot, 'dist');
  const workDir = path.join(buildRoot, 'work');
  const specDir = path.join(buildRoot, 'spec');
  const outDir = path.join(root, 'bin');
  const outExe = path.join(outDir, process.platform === 'win32' ? 'screen_processor.exe' : 'screen_processor');

  if (!fs.existsSync(processScript)) {
    throw new Error(`Processor script not found: ${processScript}`);
  }

  ensureDir(buildRoot);
  ensureDir(distDir);
  ensureDir(workDir);
  ensureDir(specDir);
  ensureDir(outDir);

  const py = resolvePythonCommand();

  console.log('[BuildProcessor] Installing Python dependencies...');
  run(py, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  run(py, ['-m', 'pip', 'install', 'pyinstaller', 'opencv-python', 'numpy']);

  console.log('[BuildProcessor] Building processor executable...');

  // The processor/ package must be bundled alongside the entry point.
  const processorPkg = path.join(root, 'scripts', 'processor');
  const addDataSep = process.platform === 'win32' ? ';' : ':';

  run(py, [
    '-m',
    'PyInstaller',
    '--noconfirm',
    '--clean',
    '--onefile',
    '--name',
    'screen_processor',
    '--add-data',
    `${processorPkg}${addDataSep}processor`,
    '--distpath',
    distDir,
    '--workpath',
    workDir,
    '--specpath',
    specDir,
    processScript,
  ]);

  const builtExe = path.join(distDir, process.platform === 'win32' ? 'screen_processor.exe' : 'screen_processor');
  if (!fs.existsSync(builtExe)) {
    throw new Error(`Built executable not found: ${builtExe}`);
  }

  fs.copyFileSync(builtExe, outExe);
  console.log(`[BuildProcessor] Ready: ${outExe}`);
}

main();