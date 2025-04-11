import { build } from 'esbuild';

const isWatch = process.argv.includes('--watch');

build({
  entryPoints: ['src/probe.ts'],
  bundle: true,
  outfile: 'dist/probe.js',
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  watch: isWatch,
  minify: false,
  sourcemap: true,
}).catch(() => process.exit(1));
