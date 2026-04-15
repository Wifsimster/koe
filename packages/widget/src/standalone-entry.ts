/**
 * IIFE entry for the CDN `<script>` build. This file exists *only*
 * because the library build externalizes React while the standalone
 * build must not. Keeping the entries separate lets Rollup tree-shake
 * correctly in each target without clever runtime checks.
 *
 * Exposed on `window.Koe` as `{ init, destroy }`.
 */
import './styles.css';
import { init, destroy } from './standalone';

export { init, destroy };
