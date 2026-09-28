import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const demo = fileURLToPath(new URL('../demo/', import.meta.url));
const requireDemo = createRequire(new URL('../demo/package.json', import.meta.url));
export default defineConfig(async () => {
  const react = (await import(requireDemo.resolve('@vitejs/plugin-react'))).default;
  const svgr = (await import(requireDemo.resolve('vite-plugin-svgr'))).default;
  const tailwindcss = requireDemo('tailwindcss');
  const autoprefixer = requireDemo('autoprefixer');
  const tailwindConfig = requireDemo('./tailwind.config.js');
  return {
    root: demo,
    plugins: [react(), svgr({ exportAsDefault: true })],
    resolve: { alias: { '@': `${demo}/src` } },
    define: { 'process.env': {} },
    css: { postcss: { plugins: [tailwindcss({ ...tailwindConfig, content: [`${demo}/index.html`, `${demo}/src/**/*.{js,ts,jsx,tsx}`] }), autoprefixer()] } },
    build: { outDir: 'dist', emptyOutDir: true }
  };
});
