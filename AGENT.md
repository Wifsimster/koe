# AGENT.md

## Resume du projet

Koe est un monorepo pour un widget support embarquable destine aux produits SaaS. Les flux reellement actifs concernent les bugs, les demandes d'evolution et le vote public. Le dashboard et le chat temps reel sont encore partiels.

## Structure et dependances

| Package           | Depend de     | Role                                       |
| ----------------- | ------------- | ------------------------------------------ |
| `@wifsimster/koe` | `@koe/shared` | Widget public publie sur npm.              |
| `@koe/api`        | `@koe/shared` | API Hono, securite et stockage PostgreSQL. |
| `@koe/dashboard`  | `@koe/shared` | Back-office React encore en preparation.   |
| `@koe/shared`     | -             | Types metier et helpers transverses.       |

## Commandes essentielles

- Installation : `pnpm install`
- Developpement global : `pnpm dev`
- Build global : `pnpm build`
- Typecheck global : `pnpm typecheck`
- Lint global : `pnpm lint`
- Test global : `pnpm test`
- API locale : `pnpm --filter @koe/api dev`
- Migrations : `pnpm --filter @koe/api db:generate` puis `pnpm --filter @koe/api db:migrate`
- Studio base : `pnpm --filter @koe/api db:studio`
- Dashboard local : `pnpm --filter @koe/dashboard dev`
- Widget local : `pnpm --filter @wifsimster/koe dev`
- Verification release : `pnpm release:dry`

## Conventions a respecter

- Garder TypeScript strict et le style Prettier existant.
- Reutiliser `@koe/shared` avant de dupliquer un type.
- Cote API, conserver l'enveloppe `ok` et `fail` ainsi que la validation Zod.
- Cote widget, privilegier des composants locaux et peu abstraits.
- Nommer les composants en `PascalCase` et les modules en `camelCase`.

## Workflow de developpement

- Branche de base : `main`.
- Branches de travail observees : `claude/...`.
- Commits : messages courts et imperatifs. Utiliser un prefixe comme `chore:` seulement si le contexte le justifie.
- CI GitHub Actions sur push et pull request vers `main`.
- Release via `semantic-release` sur push vers `main`.

## Toujours faire

- Lire l'implementation reelle avant de documenter ou d'etendre une fonctionnalite.
- Verifier l'impact multi-packages avant de changer `packages/shared`, `turbo.json` ou `tsconfig.base.json`.
- Ajouter les etapes Drizzle si le schema SQL change.
- Distinguer clairement le code actif et les ecrans placeholder.

## A eviter

- Ne pas documenter le chat temps reel comme une fonctionnalite active.
- Ne pas supposer que `better-auth` est cable. Aucune dependance active n'apparait dans ce snapshot.
- Ne pas modifier `.github/workflows/release.yml` ou `.releaserc.json` sans besoin explicite de publication.
- Ne pas casser la double build du widget definie dans `packages/widget/vite.config.ts`.

## Fichiers sensibles

- `packages/api/src/db/schema.ts`
- `packages/api/src/routes/widget.ts`
- `packages/widget/vite.config.ts`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.releaserc.json`
