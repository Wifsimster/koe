/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

// Fontsource packages ship CSS only. TypeScript 7 (tsrs) reports side-effect
// imports with no declaration (TS2882), so declare them here.
declare module '@fontsource-variable/*';
