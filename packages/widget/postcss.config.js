import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';

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
