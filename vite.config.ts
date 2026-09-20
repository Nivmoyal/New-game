import { defineConfig } from 'vite';

/**
 * חותמת בנייה — מוזרקת לקוד בזמן הבנייה ומוצגת במסך הפתיחה.
 * בלעדיה אי אפשר לדעת אם מה שרואים בדפדפן הוא הגרסה החדשה או
 * עותק מהמטמון, וזו שאלה שחוזרת בכל פרסום.
 */
const BUILD_STAMP = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  base: './',
  define: {
    __BUILD_STAMP__: JSON.stringify(BUILD_STAMP),
  },
  build: { target: 'es2022', outDir: 'dist' },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as any);
