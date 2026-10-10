import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';

/*
 * Tailwind v3 always emits its `--tw-*` defaults on `*, ::before, ::after`
 * and `::backdrop`, even with preflight off. Shipped unlayered in
 * `style.css`, that rule resets `--tw-ring-*` / `--tw-shadow*` on every
 * element of the host page and beats the host's layered Tailwind v4
 * utilities: every focus ring and shadow outside the widget disappears.
 * Scope those defaults to the widget subtree. `:where()` keeps the
 * specificity at zero, like the original `*`.
 */
const SCOPE = ':where(.koe-root, .koe-root *)';
const GLOBAL_SELECTOR = /^(\*|::(before|after|backdrop))$/;

const scopeTailwindDefaults = () => ({
  postcssPlugin: 'koe-scope-tailwind-defaults',
  Rule(rule) {
    if (rule.parent?.type !== 'root') return;
    if (!rule.selectors.every((s) => GLOBAL_SELECTOR.test(s))) return;
    rule.selectors = rule.selectors.map((s) => (s === '*' ? SCOPE : `${SCOPE}${s}`));
  },
});
scopeTailwindDefaults.postcss = true;

export default {
  plugins: [tailwindcss(), scopeTailwindDefaults(), autoprefixer()],
};
