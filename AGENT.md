# AGENT.md

## Resume du projet

Koe est un monorepo pour un widget support embarquable destine aux produits SaaS. Le widget (bugs, demandes d'evolution, vote) et l'API d'administration (inbox, bulk actions, membres, audit) sont branches. Le chat temps reel est encore un onglet de preview local.

## Structure et dependances

| Package           | Depend de     | Role                                                                 |
| ----------------- | ------------- | -------------------------------------------------------------------- |
| `@wifsimster/koe` | `@koe/shared` | Widget public (build npm + build IIFE autonome).                     |
| `@koe/api`        | `@koe/shared` | API Hono. Widget public + admin JSON + auth (password / oidc / dev). |
| `@koe/dashboard`  | `@koe/shared` | SPA React TanStack Router. Inbox, ticket detail, batches, membres.   |
| `@koe/shared`     | -             | Types metier et helpers transverses.                                 |

## Commandes essentielles

- Installation : `pnpm install`
- Developpement global : `pnpm dev`
- Build global : `pnpm build`
- Typecheck global : `pnpm typecheck`
- Lint global : `pnpm lint`
- Test global : `pnpm test` (suite principale dans `packages/api/src/{lib,middleware}/*.test.ts`)
- API locale : `pnpm --filter @koe/api dev`
- Migrations : `pnpm --filter @koe/api db:generate` puis `pnpm --filter @koe/api db:migrate`
- Studio base : `pnpm --filter @koe/api db:studio`
- Dashboard local : `pnpm --filter @koe/dashboard dev`
- Widget local : `pnpm --filter @wifsimster/koe dev`
- Creer un admin (mode password) : `pnpm --filter @koe/api admin-user -- --email you@example.com --project-key acme`
- Verification release : `pnpm release:dry`

## Conventions a respecter

- Garder TypeScript strict et le style Prettier existant.
- Reutiliser `@koe/shared` avant de dupliquer un type.
- Cote API, conserver l'enveloppe `ok` et `fail` ainsi que la validation Zod pres de la route.
- Cote API admin, toujours passer par les middlewares `requireAdminSession`, `requireProjectMember`, `requireProjectWriter`, `requireProjectOwner`. Ne jamais deduire l'autorisation de la seule session.
- Cote widget, privilegier des composants locaux et peu abstraits.
- Nommer les composants en `PascalCase` et les modules en `camelCase`.

## Workflow de developpement

- Branche de base : `main`.
- Branches de travail observees : `claude/...`.
- Commits : Conventional Commits (`feat(widget): ...`, `fix(api): ...`). C'est ce que consomme `semantic-release`.
- CI GitHub Actions sur push et pull request vers `main`.
- Release widget via `semantic-release` sur push `main` (tags `v*`). Release image serveur via push d'un tag git `server-v*`.

## Toujours faire

- Lire l'implementation reelle avant de documenter ou d'etendre une fonctionnalite.
- Verifier l'impact multi-packages avant de changer `packages/shared`, `turbo.json` ou `tsconfig.base.json`.
- Ajouter les etapes Drizzle si le schema SQL change (`db:generate` puis commit de la migration generee).
- Sur toute route admin qui mute un ticket, emettre les evenements d'audit correspondants (`admin_ticket_events`) dans la meme transaction.
- Pour une action en lot (bulk), correler les evenements via un `batchId` commun.

## A eviter

- Ne pas documenter le chat temps reel comme une fonctionnalite active.
- Ne pas ressusciter `better-auth` : il a ete abandonne au profit de `openid-client` + argon2id. Les variables `BETTER_AUTH_*` n'existent plus.
- Ne pas activer `ADMIN_AUTH_MODE=dev-session` en production (l'API refuse de demarrer).
- Ne pas stocker les secrets d'identite en clair une fois `KOE_SECRET_KEYS` actif : passer par `getSecretStoreFromEnv()`.
- Ne pas oublier Redis (`REDIS_URL`) des qu'on scale au-dela d'un replica : le rate limiter et l'anti-rejeu sont per-pod sinon.
- Ne pas modifier `.github/workflows/widget-release.yml` ou `.releaserc.json` sans besoin explicite de publication.
- Ne pas casser la double build du widget definie dans `packages/widget/vite.config.ts`.

## Fichiers sensibles

- `packages/api/src/index.ts` (montage conditionnel des routes admin)
- `packages/api/src/db/schema.ts`
- `packages/api/src/routes/widget.ts`
- `packages/api/src/routes/adminApi.ts`
- `packages/api/src/middleware/adminAuth.ts`
- `packages/api/src/lib/identityToken.ts`
- `packages/api/src/lib/secretStore.ts`
- `packages/widget/vite.config.ts`
- `.github/workflows/ci.yml`
- `.github/workflows/widget-release.yml`
- `.github/workflows/server-image.yml`
- `.releaserc.json`
