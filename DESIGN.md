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
    secondary: "oklch(0.967 0.001 286.375)"
    secondary-foreground: "oklch(0.21 0.006 285.885)"
    muted: "oklch(0.97 0 0)"
    muted-foreground: "oklch(0.556 0 0)"
    accent: "oklch(0.97 0 0)"
    accent-foreground: "oklch(0.205 0 0)"
    destructive: "oklch(0.577 0.245 27.325)"
    border: "oklch(0.922 0 0)"
    input: "oklch(0.922 0 0)"
    ring: "oklch(0.708 0 0)"
    chart: ["oklch(0.205 0 0)", "oklch(0.37 0 0)", "oklch(0.556 0 0)", "oklch(0.708 0 0)", "oklch(0.837 0 0)"]
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
    widget-field-border: "#c4c4c4"
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
    primary: "oklch(0.985 0 0)"
    primary-foreground: "oklch(0.205 0 0)"
    secondary: "oklch(0.274 0.006 286.033)"
    secondary-foreground: "oklch(0.985 0 0)"
    muted: "oklch(0.269 0 0)"
    muted-foreground: "oklch(0.708 0 0)"
    accent: "oklch(0.269 0 0)"
    accent-foreground: "oklch(0.985 0 0)"
    destructive: "oklch(0.704 0.191 22.216)"
    border: "oklch(1 0 0 / 10%)"
    input: "oklch(1 0 0 / 15%)"
    ring: "oklch(0.556 0 0)"
    chart: ["oklch(0.985 0 0)", "oklch(0.837 0 0)", "oklch(0.708 0 0)", "oklch(0.556 0 0)", "oklch(0.439 0 0)"]
    sidebar: "oklch(0.205 0 0)"
    sidebar-foreground: "oklch(0.985 0 0)"
    sidebar-primary: "oklch(0.985 0 0)"
    sidebar-primary-foreground: "oklch(0.205 0 0)"
    sidebar-accent: "oklch(0.269 0 0)"
    sidebar-accent-foreground: "oklch(0.985 0 0)"
    sidebar-border: "oklch(1 0 0 / 10%)"
    sidebar-ring: "oklch(0.556 0 0)"
    widget-bg: "#0a0a0a"
    widget-bg-muted: "#171717"
    widget-border: "#262626"
    widget-field-border: "#3f3f3f"
    widget-text: "#fafafa"
    widget-text-muted: "#a3a3a3"
    widget-text-hover: "#e5e5e5"
typography:
  dashboard-body: "'JetBrains Mono Variable', ui-monospace, monospace"
  dashboard-heading: "'Geist Variable', ui-sans-serif, sans-serif"
  widget: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
  widget-base-size: 13px
  scale: tailwind-default
rounded:
  dashboard: 0 (rounded-none on every primitive; --radius 0.625rem declared)
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
  icons: lucide-react
  tailwind: v3.4
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
| `--primary` | `oklch(0.205 0 0)` | `oklch(0.985 0 0)` |
| `--primary-foreground` | `oklch(0.985 0 0)` | `oklch(0.205 0 0)` |
| `--secondary` | `oklch(0.967 0.001 286.375)` | `oklch(0.274 0.006 286.033)` |
| `--secondary-foreground` | `oklch(0.21 0.006 285.885)` | `oklch(0.985 0 0)` |
| `--muted` / `--accent` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` |
| `--muted-foreground` | `oklch(0.556 0 0)` | `oklch(0.708 0 0)` |
| `--accent-foreground` | `oklch(0.205 0 0)` | `oklch(0.985 0 0)` |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` |
| `--border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 10%)` |
| `--input` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 15%)` |
| `--ring` | `oklch(0.708 0 0)` | `oklch(0.556 0 0)` |
| `--chart-1…5` | `0.205`, `0.37`, `0.556`, `0.708`, `0.837` (L, chroma 0) | `0.985`, `0.837`, `0.708`, `0.556`, `0.439` |
| `--sidebar-*` | `oklch(0.985 0 0)` fond, mêmes valeurs que primary/accent/border/ring | `oklch(0.205 0 0)` fond, idem |

Mapping Tailwind dans `packages/dashboard/tailwind.config.js` (`darkMode:
['class']`, couleurs `var(--…)`). Thème piloté par
`components/theme-provider.tsx` + `ModeToggle`.

### Widget (`packages/widget/src/styles.css`, `tailwind.config.js`)

| Token | Clair (`.koe-root`) | Sombre (`data-mode='dark'`, ou `auto` + `prefers-color-scheme: dark`) |
| --- | --- | --- |
| `--koe-bg` | `#ffffff` | `#0a0a0a` |
| `--koe-bg-muted` | `#f7f7f7` | `#171717` |
| `--koe-border` | `#e5e5e5` | `#262626` |
| `--koe-field-border` | non défini, repli `#c4c4c4` | `#3f3f3f` |
| `--koe-text` | `#0a0a0a` | `#fafafa` |
| `--koe-text-muted` | `#737373` | `#a3a3a3` |
| `--koe-text-hover` | `#262626` | `#e5e5e5` |
| `--koe-accent` / `-hover` | `theme.accentColor` de l'hôte, sinon `--koe-text` / `--koe-text-hover` ; hover = accent assombri de 8 % (`src/theme.ts`) | idem |

## Typography

| Surface | Rôle | Famille | Source |
| --- | --- | --- | --- |
| Dashboard | Corps (tout le `html`) | `'JetBrains Mono Variable', ui-monospace, monospace` via `@fontsource-variable/jetbrains-mono` | `styles.css` (`html { @apply font-mono }`) |
| Dashboard | Titres (`font-heading`, 20 usages) | `'Geist Variable', ui-sans-serif, sans-serif` via `@fontsource-variable/geist` | `styles.css`, `tailwind.config.js` |
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

- Dashboard : pas d'ombre. La Card se détache par un filet `ring-1 ring-foreground/10` (voir Known Gaps).
- Widget : `shadow-koe` = `0 1px 3px rgba(0,0,0,0.06), 0 10px 30px -10px rgba(0,0,0,0.2)`.

## Shapes

- Dashboard : `rounded-none` sur Button, Input, Card et leurs sous-parties (style `radix-lyra`). `--radius: 0.625rem` et `borderRadius.lg|md|sm` existent dans la config mais les primitives ne les utilisent pas.
- Widget : `rounded-koe` = `var(--koe-radius, 0)`, carré par défaut ; `theme.radius` (px) arrondit panneau, lanceur, boutons et champs ensemble.

## Components

shadcn `radix-lyra` (`components.json` : `menuColor: default`, `menuAccent:
subtle`), primitives `radix-ui`, icônes `lucide-react`, `tw-animate-css` et
`shadcn/tailwind.css` importés.

| Composant | Conventions | Source |
| --- | --- | --- |
| `Button` | Variantes `default`, `outline`, `secondary`, `ghost`, `destructive` (fond `destructive/10`, texte destructive), `link` ; tailles `xs`, `sm`, `default`, `lg`, `icon`, `icon-xs`, `icon-sm`, `icon-lg` ; `text-xs font-medium`, `active:translate-y-px`, icônes via `data-icon` | `ui/button-variants.ts` |
| `Badge` | Recette séparée | `ui/badge-variants.ts` |
| `Card` | `rounded-none`, `ring-1 ring-foreground/10`, prop `size` (`sm`) | `ui/card.tsx` |
| `Input` | `h-8 rounded-none border-input bg-transparent px-2.5 text-xs` | `ui/input.tsx` |
| Maison | `ConfirmDialog`, `HeartbeatBadge`, `ModeToggle`, `ProjectSwitcher`, `RouteFallbacks` | `src/components/` |
| Widget | Panneau `<dialog>` non modal, `IntentPicker` en `<fieldset>`, resets en `:where()` (spécificité 0), preflight désactivé | `widget/src/styles.css` |

Focus : `* { outline-color: color-mix(in oklch, var(--ring) 50%, transparent)
}` ; Button `focus-visible:border-ring ring-1 ring-ring/50`.

## Do's and Don'ts

**À faire**
- Rester neutre : l'encre (`primary`) est la seule couleur d'action.
- Coins carrés dans le dashboard ; dans le widget, lire `--koe-radius`.
- Préfixer toute classe widget par `koe-` et la garder sous `.koe-root`.
- Mono pour le texte courant, Geist pour les titres.

**À éviter**
- Un accent coloré en dur dans le widget : la teinte vient de l'hôte.
- Des styles widget à spécificité non nulle sur les éléments natifs (utiliser `:where()`).
- Un `rounded-*` sur une primitive du dashboard.

## Responsive

Dashboard : ruptures Tailwind par défaut, sidebar shadcn (`Sheet` sur
mobile). Widget : rupture unique `max-width: 480px` (bottom sheet),
`--koe-vvh` suit le clavier virtuel, `prefers-reduced-motion` respecté.

## Known Gaps

Écarts constatés dans le code, non corrigés ici.

1. **Modificateurs d'opacité non générés (dashboard)** : Tailwind v3.4 + couleurs `var(--…)` sans `<alpha-value>` ⇒ `bg-primary/80`, `ring-foreground/10`, `bg-destructive/10`, `ring-ring/50`, `bg-input/30`… n'existent pas dans le CSS compilé (vérifié sur `vite build` : 0 occurrence). 27 classes distinctes concernées dans `src/`, dont le filet des Card, le fond du Button `destructive` et plusieurs survols.
2. **Composants Tailwind v4 sur un projet v3** : les primitives `radix-lyra` et `shadcn/tailwind.css` sont écrits pour v4 (`has-data-[…]`, `@container/card-header`, `group-data-[size=sm]/card`), alors que `package.json` épingle `tailwindcss ^3.4.15`.
3. **`--radius: 0.625rem` inerte** : déclaré et mappé (`borderRadius.lg|md|sm`), mais toutes les primitives sont `rounded-none`.
4. **`destructive-foreground` absent** : `tailwind.config.js` mappe `destructive.foreground` sur `var(--primary-foreground)`, aucun `--destructive-foreground` n'est défini.
5. **Deux piles mono** : le dashboard charge JetBrains Mono, le widget utilise la mono système (`ui-monospace, SFMono-Regular…`).
6. **`--koe-field-border`** n'a pas de valeur claire déclarée : seul le repli `#c4c4c4` dans les règles le fournit.
7. **`--secondary` teinté** (hue 286, chroma 0.001–0.006) alors que tous les autres neutres sont à chroma 0.
8. **Ombre widget en `rgba()`** alors que le dashboard n'a aucune ombre : les deux surfaces ne partagent pas la même élévation.
