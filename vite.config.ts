import { defineConfig } from 'vite';

// GitHub Pages のサブディレクトリ配下でも動作するよう相対パスを指定
export default defineConfig({
  base: './',
});
