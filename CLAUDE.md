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
- `packages/api` : API Hono, middlewares, schema Drizzle et acces PostgreSQL. Bundle via tsup (entrypoints `bin/serve.ts`, `bin/migrate.ts`, `bin/bootstrap.ts`).
- `packages/dashboard` : shell de back-office React avec routes et pages placeholder. Embarque dans l'image Docker du serveur, servi a `/admin/` quand `ENABLE_DASHBOARD=true` (defaut).
- `packages/shared` : types metier partages et helper `captureBrowserMetadata`.
- `packages/api/Dockerfile` : build multi-stage publie sur `ghcr.io/wifsimster/koe-server` (bundle API + dashboard).
- `docker-compose.yml` + `.env.docker.example` : self-host en une commande (serveur + PostgreSQL).
- `.github/workflows/widget-release.yml` : widget via semantic-release, tags `v*`.
- `.github/workflows/server-image.yml` : image serveur, tags roulants `:edge` + `:sha-*` sur push main, tags stables sur push de `server-v*`.
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
- La release widget se declenche sur chaque push `main` et produit des tags `vX.Y.Z`.
- L'image Docker de l'API est republiee sur chaque push `main` (tags `:edge` + `:sha-*`) ; les tags stables `:latest`, `:X.Y.Z` viennent d'un tag git `api-vX.Y.Z` pousse manuellement.
- Le proxy git de l'environnement refuse le push de tags et les suppressions de refs. Passer par l'UI GitHub ou un poste local pour ces operations.

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
- Aucun package n'est publie sur npm. Le widget se consomme via tags git `v*` ; le serveur se consomme via l'image Docker `ghcr.io/wifsimster/koe-server` (qui bundle API + dashboard). `@koe/api`, `@koe/dashboard` et `@koe/shared` restent prives au workspace.
- `packages/api/.env.example` contient les variables indispensables. Sans `DATABASE_URL`, les routes DB renverront une erreur.
- Toute modification de `packages/api/src/db/schema.ts` implique le workflow Drizzle.
- L'image Docker execute les migrations au boot par defaut (`MIGRATE_ON_START=true`). Desactiver en multi-replicas et lancer `docker compose run --rm api migrate` avant le scale-up.
- Ne supposez pas que `better-auth` est deja cable. Ce snapshot ne montre aucune dependance active. Le dashboard est donc expose sans auth a `/admin/` — `ENABLE_DASHBOARD=false` pour le couper en exposition publique.
- Toute modif des deps d'un package oblige a regenerer `pnpm-lock.yaml` ; la CI `--frozen-lockfile` echoue sinon.

## Patterns a suivre

- Reutiliser `@koe/shared` pour les types et helpers transverses.
- Preferer de petits middlewares Hono separes plutot qu'une grosse route monolithique.
- Garder les formulaires du widget simples, locaux et sans state management externe.
- Distinguer clairement ce qui est en production et ce qui est seulement prepare.
