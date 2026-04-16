# CLAUDE.md

## Vue d'ensemble

Koe est un monorepo `pnpm` et Turborepo pour un widget support embarquable, une API publique et un back-office React. Les fonctionnalites reellement branchees couvrent les bugs, les demandes d'evolution et le vote public. Le dashboard et le chat temps reel sont encore partiels.

## Stack et dependances cles

- Node `>=20`
- `pnpm@9.12.0`
- TypeScript `5.6.x`
- Turbo `2.3.x`
- Prettier `3.3.x`
- React `19.x`
- Vite `6.x`
- Tailwind CSS `3.4.x`
- Hono `4.6.x`
- Drizzle ORM `0.36.x`
- `postgres` `3.4.x`
- Zod `3.23.x`
- TanStack Router `1.82.x`
- semantic-release `24.x`

## Structure du projet

- `packages/widget` : widget React embarquable, avec build librairie ES et build IIFE autonome.
- `packages/api` : API Hono, middlewares, schema Drizzle et acces PostgreSQL.
- `packages/dashboard` : shell de back-office React avec routes et pages placeholder.
- `packages/shared` : types metier partages et helper `captureBrowserMetadata`.
- `.github/workflows` : CI et release.
- `.releaserc.json` : orchestration des tags et GitHub Releases automatiques via `semantic-release`.
- `tsconfig.base.json` : options TypeScript strictes partagees.

## Commandes utiles

- `pnpm install`
- `pnpm dev`
- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test` : pipeline prevu, mais peu ou pas de suites sont branchees.
- `pnpm --filter @koe/api dev`
- `pnpm --filter @koe/api db:generate`
- `pnpm --filter @koe/api db:migrate`
- `pnpm --filter @koe/api db:studio`
- `pnpm --filter @koe/dashboard dev`
- `pnpm --filter @wifsimster/koe dev`
- `pnpm release:dry`

## Conventions de code

- TypeScript strict. Voir `tsconfig.base.json`.
- ESM partout.
- Formatage Prettier : `semi: true`, `singleQuote: true`, `trailingComma: all`, `printWidth: 100`.
- Composants React en `PascalCase.tsx`.
- Helpers, contextes et middlewares en `camelCase.ts` ou `camelCase.tsx`.
- Types partages dans `@koe/shared`. Reutilisez-les avant de creer de nouveaux contrats.
- Cote API, valider toute entree externe avec Zod pres de la route.
- Utiliser `ok()` et `fail()` pour conserver l'enveloppe JSON commune.

## Workflow git

- Branche de base : `main`.
- Branches observees : branches de travail de type `claude/...`.
- Commits observes : messages courts a l'imperatif. Les releases s'appuient sur Conventional Commits et `semantic-release`.
- La release GitHub Actions se declenche sur `main` et s'appuie sur `semantic-release`.

## Fichiers et dossiers cles

- `packages/api/src/routes/widget.ts` : endpoints widget reellement implementes.
- `packages/api/src/db/schema.ts` : modele de donnees central.
- `packages/api/src/middleware/project.ts` : resolution et validation du projet.
- `packages/api/src/middleware/identity.ts` : verification HMAC des contributeurs.
- `packages/api/src/middleware/cors.ts` : CORS dynamique par projet.
- `packages/api/src/middleware/rateLimit.ts` : limitation de debit en memoire.
- `packages/widget/src/api/client.ts` : transport widget vers API.
- `packages/widget/src/components/Panel.tsx` : navigation entre onglets du widget.
- `packages/widget/vite.config.ts` : double build librairie et IIFE.
- `packages/shared/src/types/*` : types de reference du produit.
- `packages/shared/src/metadata.ts` : capture du contexte navigateur.

## Gotchas et points d'attention

- Le dashboard est surtout un squelette UI. L'API d'administration n'est pas encore branchee.
- Le chat temps reel n'est pas branche. Le widget affiche une conversation locale de previsualisation.
- Aucun package n'est publie sur npm. Les releases du widget se font via tags git et GitHub Releases. `@koe/api`, `@koe/dashboard` et `@koe/shared` restent prives.
- `packages/api/.env.example` contient les variables indispensables. Sans `DATABASE_URL`, les routes DB renverront une erreur.
- Toute modification de `packages/api/src/db/schema.ts` implique le workflow Drizzle.
- Ne supposez pas que `better-auth` est deja cable. Ce snapshot ne montre aucune dependance active.

## Patterns a suivre

- Reutiliser `@koe/shared` pour les types et helpers transverses.
- Preferer de petits middlewares Hono separes plutot qu'une grosse route monolithique.
- Garder les formulaires du widget simples, locaux et sans state management externe.
- Distinguer clairement ce qui est en production et ce qui est seulement prepare.
