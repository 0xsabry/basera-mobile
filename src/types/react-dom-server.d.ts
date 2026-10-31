/**
 * Minimal typings for react-dom/server — used ONLY by the jest render
 * smoke tests (react-dom ships in the bundle for web, but @types/react-dom
 * is not installed and dependencies are frozen).
 */
declare module 'react-dom/server' {
  import type { ReactNode } from 'react';
  export function renderToStaticMarkup(node: ReactNode): string;
  export function renderToString(node: ReactNode): string;
}
