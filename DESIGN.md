---
name: Kōe
source:
  dashboard: packages/dashboard/src/styles.css
  widget: packages/widget/src/styles.css
mode: light + dark (dashboard .dark class; widget data-mode light|dark|auto)
colors:
  light:
    background: "oklch(1 0 0)"
    foreground: "oklch(0.145 0 0)"
    card: "oklch(1 0 0)"
    card-foreground: "oklch(0.145 0 0)"
    popover: "oklch(1 0 0)"
    popover-foreground: "oklch(0.145 0 0)"
    primary: "oklch(0.205 0 0)"
    primary-foreground: "oklch(0.985 0 0)"
    secondary: "oklch(0.97 0 0)"
    secondary-foreground: "oklch(0.205 0 0)"
    muted: "oklch(0.97 0 0)"
    muted-foreground: "oklch(0.556 0 0)"
    accent: "oklch(0.97 0 0)"
    accent-foreground: "oklch(0.205 0 0)"
    destructive: "oklch(0.577 0.245 27.325)"
    destructive-foreground: "oklch(0.985 0 0)"
    border: "oklch(0.922 0 0)"
    input: "oklch(0.922 0 0)"
    ring: "oklch(0.708 0 0)"
    chart: ["oklch(0.87 0 0)", "oklch(0.556 0 0)", "oklch(0.439 0 0)", "oklch(0.371 0 0)", "oklch(0.269 0 0)"]
    sidebar: "oklch(0.985 0 0)"
    sidebar-foreground: "oklch(0.145 0 0)"
    sidebar-primary: "oklch(0.205 0 0)"
    sidebar-primary-foreground: "oklch(0.985 0 0)"
    sidebar-accent: "oklch(0.97 0 0)"
    sidebar-accent-foreground: "oklch(0.205 0 0)"
    sidebar-border: "oklch(0.922 0 0)"
    sidebar-ring: "oklch(0.708 0 0)"
    widget-bg: "#ffffff"
    widget-bg-muted: "#f7f7f7"
    widget-border: "#e5e5e5"
    widget-field-border: "#949494"
    widget-text: "#0a0a0a"
    widget-text-muted: "#737373"
    widget-text-hover: "#262626"
  dark:
    background: "oklch(0.145 0 0)"
    foreground: "oklch(0.985 0 0)"
    card: "oklch(0.205 0 0)"
    card-foreground: "oklch(0.985 0 0)"
    popover: "oklch(0.205 0 0)"
    popover-foreground: "oklch(0.985 0 0)"
    primary: "oklch(0.922 0 0)"
    primary-foreground: "oklch(0.205 0 0)"
    secondary: "oklch(0.269 0 0)"
    secondary-foreground: "oklch(0.985 0 0)"
    muted: "oklch(0.269 0 0)"
    muted-foreground: "oklch(0.708 0 0)"
    accent: "oklch(0.269 0 0)"
    accent-foreground: "oklch(0.985 0 0)"
    destructive: "oklch(0.704 0.191 22.216)"
    destructive-foreground: "oklch(0.205 0 0)"
    border: "oklch(1 0 0 / 10%)"
    input: "oklch(1 0 0 / 15%)"
    ring: "oklch(0.556 0 0)"
    chart: ["oklch(0.87 0 0)", "oklch(0.556 0 0)", "oklch(0.439 0 0)", "oklch(0.371 0 0)", "oklch(0.269 0 0)"]
    sidebar: "oklch(0.205 0 0)"
    sidebar-foreground: "oklch(0.985 0 0)"
    sidebar-primary: "oklch(0.922 0 0)"
    sidebar-primary-foreground: "oklch(0.205 0 0)"
    sidebar-accent: "oklch(0.269 0 0)"
    sidebar-accent-foreground: "oklch(0.985 0 0)"
    sidebar-border: "oklch(1 0 0 / 10%)"
    sidebar-ring: "oklch(0.556 0 0)"
    widget-bg: "#0a0a0a"
    widget-bg-muted: "#171717"
    widget-border: "#262626"
    widget-field-border: "#5d5d5d"
    widget-text: "#fafafa"
    widget-text-muted: "#a3a3a3"
    widget-text-hover: "#e5e5e5"
typography:
  dashboard-body: "'JetBrains Mono Variable', ui-monospace, monospace"
  dashboard-heading: "'JetBrains Mono Variable', monospace (font-heading = font-mono)"
  widget: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
  widget-base-size: 13px
  scale: tailwind-default
rounded:
  dashboard: 0 (rounded-none on every primitive; --radius 0)
  widget: "var(--koe-radius, 0)"
elevation:
  dashboard: ring-1 ring-foreground/10 (hairline, no shadow)
  widget: "0 1px 3px rgba(0,0,0,0.06), 0 10px 30px -10px rgba(0,0,0,0.2)"
spacing:
  scale: tailwind-default (4px)
  control-h: 32px (h-8)
components:
  style: radix-lyra
  primitives: radix (radix-ui)
  icons: "@phosphor-icons/react (primitives), lucide-react (pages)"
  tailwind: "dashboard v4 (@tailwindcss/postcss), widget v3.4"
---

# Kōe — DESIGN.md

Ce fichier décrit le design system **tel qu'il existe dans le code**. Il ne
propose rien. Chaque valeur vient du fichier cité ; en cas d'écart, le code
fait foi et l'écart va dans [Known Gaps](#known-gaps).

Deux surfaces partagent un langage, avec deux implémentations :

- **Dashboard** (`packages/dashboard`) : console d'administration, shadcn `radix-lyra`.
- **Widget** (`packages/widget`) : widget de support embarqué chez l'hôte, CSS isolé sous `.koe-root`, classes préfixées `koe-`.

## Overview

Widget de support pour SaaS. Registre **éditorial et technique** : neutres
purs (chroma 0), typographie monospace, filets fins, **coins carrés**, pas
d'accent coloré. L'action principale est l'encre elle-même (noir en clair,
blanc en sombre). Le widget reprend ce langage et laisse l'hôte teinter les
affordances discrètes (`accentColor`) et arrondir les coins (`radius`).

## Colors

### Dashboard (`packages/dashboard/src/styles.css`, `:root` et `.dark` dans `@layer base`)

Palette shadcn *neutral* d'origine, en OKLCH.

| Token | Clair | Sombre |
| --- | --- | --- |
| `--background` | `oklch(1 0 0)` | `oklch(0.145 0 0)` |
| `--foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` |
| `--card` / `--popover` | `oklch(1 0 0)` | `oklch(0.205 0 0)` |
| `--primary` | `oklch(0.205 0 0)` | `oklch(0.922 0 0)` |
| `--primary-foreground` | `oklch(0.985 0 0)` | `oklch(0.205 0 0)` |
| `--secondary` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` |
| `--secondary-foreground` | `oklch(0.205 0 0)` | `oklch(0.985 0 0)` |
| `--muted` / `--accent` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` |
| `--muted-foreground` | `oklch(0.556 0 0)` | `oklch(0.708 0 0)` |
| `--accent-foreground` | `oklch(0.205 0 0)` | `oklch(0.985 0 0)` |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` |
| `--destructive-foreground` | `oklch(0.985 0 0)` (4.56:1 sur destructive) | `oklch(0.205 0 0)` (6.19:1) |
| `--border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 10%)` |
| `--input` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 15%)` |
| `--ring` | `oklch(0.708 0 0)` | `oklch(0.556 0 0)` |
| `--chart-1…5` | `0.87`, `0.556`, `0.439`, `0.371`, `0.269` (L, chroma 0) | idem |
| `--sidebar-*` | `oklch(0.985 0 0)` fond, mêmes valeurs que primary/accent/border/ring | `oklch(0.205 0 0)` fond, idem (`--sidebar-primary` = `--primary`) |

Mapping Tailwind v4 dans le bloc `@theme inline` de `styles.css` (`--color-*:
var(--…)`, variante `dark` = `&:is(.dark *)`). Thème piloté par
`components/theme-provider.tsx` + `ModeToggle`.

### Widget (`packages/widget/src/styles.css`, `tailwind.config.js`)

| Token | Clair (`.koe-root`) | Sombre (`data-mode='dark'`, ou `auto` + `prefers-color-scheme: dark`) |
| --- | --- | --- |
| `--koe-bg` | `#ffffff` | `#0a0a0a` |
| `--koe-bg-muted` | `#f7f7f7` | `#171717` |
| `--koe-border` | `#e5e5e5` | `#262626` |
| `--koe-field-border` | `#949494` (3.03:1 sur `--koe-bg`) | `#5d5d5d` (3.01:1) |
| `--koe-text` | `#0a0a0a` | `#fafafa` |
| `--koe-text-muted` | `#737373` | `#a3a3a3` |
| `--koe-text-hover` | `#262626` | `#e5e5e5` |
| `--koe-accent` / `-hover` | `theme.accentColor` de l'hôte, sinon `--koe-text` / `--koe-text-hover` ; hover = accent assombri de 8 % (`src/theme.ts`) | idem |

## Typography

| Surface | Rôle | Famille | Source |
| --- | --- | --- | --- |
| Dashboard | Corps (tout le `html`) | `'JetBrains Mono Variable', ui-monospace, monospace` via `@fontsource-variable/jetbrains-mono` | `styles.css` (`html { @apply font-mono }`) |
| Dashboard | Titres (`font-heading`, 20 usages) | `--font-heading: var(--font-mono)` (JetBrains Mono) | `styles.css` (`@theme inline`) |
| Widget | Tout | `ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace`, 13 px / 1.5 | `widget/src/styles.css` |

Échelle : Tailwind par défaut. Densité *lyra* : contrôles et cartes en
`text-xs` (Card `text-xs/relaxed`), titres de carte `font-heading text-sm
font-medium`. Titres de page `font-heading text-2xl`–`text-3xl
tracking-tight` ; héros en `clamp()` (`LoginPage`, `InboxPage`,
`TicketDetailPage`) avec `tracking-tighter`. Chiffres en `tabular-nums`.
Widget : libellés 10–11 px, compteurs 14 px `font-weight: 600`.

## Layout

- Espacement Tailwind par défaut. Contrôles 32 px (`h-8`) ; tailles Button `xs` 24, `sm` 28, `default` 32, `lg` 36 px (`ui/button-variants.ts`).
- Card : `gap-4 py-4`, `px-4` (`size=sm` : `px-3`), pied `border-t p-4`.
- Coquille : `AppShell`, `AppLayout` avec `ui/sidebar.tsx`, `ProjectSwitcher`.
- Widget : panneau flottant 360 px (`max-width: calc(100vw - 2rem)`, `max-height: min(60vh, var(--koe-vvh))`) ; sous 480 px, bottom sheet (`max-height: min(85dvh, …)`, poignée 36 × 3 px, `safe-area-inset-bottom`). Position par `positionToClasses` (`bottom-4`/`right-4`…).

## Elevation

- Dashboard : pas d'ombre. La Card se détache par un filet `ring-1 ring-foreground/10` (généré depuis Tailwind v4).
- Widget : `shadow-koe` = `0 1px 3px rgba(0,0,0,0.06), 0 10px 30px -10px rgba(0,0,0,0.2)`.

## Shapes

- Dashboard : `rounded-none` sur Button, Input, Card et leurs sous-parties (style `radix-lyra`). `--radius: 0`, donc `rounded-sm…4xl` valent 0 aussi.
- Widget : `rounded-koe` = `var(--koe-radius, 0)`, carré par défaut ; `theme.radius` (px) arrondit panneau, lanceur, boutons et champs ensemble.

## Components

shadcn `radix-lyra` (`components.json` : `menuColor: default`, `menuAccent:
subtle`, `iconLibrary: phosphor`), primitives `radix-ui`, icônes
`@phosphor-icons/react` dans les primitives et `lucide-react` dans les pages, `tw-animate-css` et
`shadcn/tailwind.css` importés.

| Composant | Conventions | Source |
| --- | --- | --- |
| `Button` | Variantes `default`, `outline`, `secondary`, `ghost`, `destructive` (fond `destructive/10`, texte destructive), `link` ; tailles `xs`, `sm`, `default`, `lg`, `icon`, `icon-xs`, `icon-sm`, `icon-lg` ; `text-xs font-medium`, `active:translate-y-px`, icônes via `data-icon` | `ui/button-variants.ts` |
| `Badge` | Recette séparée | `ui/badge-variants.ts` |
| `Card` | `rounded-none`, `ring-1 ring-foreground/10`, prop `size` (`sm`) | `ui/card.tsx` |
| `Input` | `h-8 rounded-none border-input bg-transparent px-2.5 text-xs` | `ui/input.tsx` |
| Maison | `ConfirmDialog`, `HeartbeatBadge`, `ModeToggle`, `ProjectSwitcher`, `RouteFallbacks` | `src/components/` |
| Widget | Panneau `<dialog>` non modal, `IntentPicker` en `<fieldset>`, resets en `:where()` (spécificité 0), preflight désactivé, défauts `--tw-*` de Tailwind limités à `:where(.koe-root, .koe-root *)` | `widget/src/styles.css`, `widget/postcss.config.js` |

Focus : `* { outline-color: color-mix(in oklch, var(--ring) 50%, transparent)
}` ; Button `focus-visible:border-ring ring-1 ring-ring/50`.

## Do's and Don'ts

**À faire**
- Rester neutre : l'encre (`primary`) est la seule couleur d'action.
- Coins carrés dans le dashboard ; dans le widget, lire `--koe-radius`.
- Préfixer toute classe widget par `koe-` et la garder sous `.koe-root`.
- Mono partout, titres compris (`font-heading` = `font-mono`).

**À éviter**
- Un accent coloré en dur dans le widget : la teinte vient de l'hôte.
- Des styles widget à spécificité non nulle sur les éléments natifs (utiliser `:where()`).
- Une règle widget globale (`*`, `::before`, `:root`, `html`…) : `style.css` est chargé par l'hôte, non layeré, et gagne sur ses utilitaires Tailwind v4.
- Un `rounded-*` sur une primitive du dashboard.

## Responsive

Dashboard : ruptures Tailwind par défaut, sidebar shadcn (`Sheet` sur
mobile). Widget : rupture unique `max-width: 480px` (bottom sheet),
`--koe-vvh` suit le clavier virtuel, `prefers-reduced-motion` respecté.

## Known Gaps

Écarts constatés dans le code et non corrigés. Corrigés par
[#93](https://github.com/Wifsimster/koe/pull/93) (Tailwind v4 + preset lyra) :
modificateurs d'opacité non générés, primitives v4 sur un projet v3, `--secondary`
teinté. Corrigés par la PR design-fixes : reset `--tw-*` global du widget,
`--radius` inerte, `--destructive-foreground` absent, `--koe-field-border` sans
valeur claire (et sous 3:1), `--sidebar-primary` bleu en sombre.

1. **Deux piles mono** : le dashboard charge JetBrains Mono, le widget utilise la mono système (`ui-monospace, SFMono-Regular…`). Voulu : le widget ne charge pas de police chez l'hôte.
2. **Ombre widget en `rgba()`** alors que le dashboard n'a aucune ombre. Voulu : le panneau flotte au-dessus d'une page hôte inconnue et doit s'en détacher.
3. **Geist chargée mais inutilisée** : `main.tsx` importe `@fontsource-variable/geist` alors que `--font-heading` pointe sur la mono depuis le preset lyra.
4. **Deux bibliothèques d'icônes** dans le dashboard : Phosphor dans les primitives (`iconLibrary: phosphor`), `lucide-react` dans les pages et composants maison.
5. **Widget encore en Tailwind v3.4** alors que le dashboard est en v4.
