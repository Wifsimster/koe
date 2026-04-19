# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Vue d'ensemble

Koe est un monorepo `pnpm` + Turborepo pour un widget support embarquable self-hosted (bugs, demandes d'evolution, vote public) et son back-office. Produit auto-heberge : aucune instance geree. Distribue sous forme d'image Docker `ghcr.io/wifsimster/koe-server` (API + dashboard bundles) et de tags git `v*` pour le widget (consomme via `github:Wifsimster/koe#vX.Y.Z` ou jsDelivr). Le chat temps reel existe comme onglet de preview mais n'est pas branche.

## Packages

| Package           | Role                                                                 | Publication                           |
| ----------------- | -------------------------------------------------------------------- | ------------------------------------- |
| `@wifsimster/koe` | Widget React (build lib ESM + build IIFE autonome avec React inline) | Tags git `v*`, pas de npm             |
| `@koe/api`        | API Hono : widget public + admin JSON + auth admin                   | Image Docker (bundle tsup)            |
| `@koe/dashboard`  | SPA TanStack Router : inbox, ticket detail, batches, membres         | Embarquee dans l'image API (`/admin/`)|
| `@koe/shared`     | Types metier et helpers transverses (`captureBrowserMetadata`)       | Prive au workspace                    |

## Stack et versions

- Node `>=20.8.1`, `pnpm@9.12.0`, TypeScript `5.6.x`, Turbo `2.3.x`, Prettier `3.3.x`
- React `19.x`, Vite `6.x`, Tailwind `3.4.x`, TanStack Router `1.82.x`
- Hono `4.6.x`, Drizzle ORM `0.36.x`, `postgres` `3.4.x`, Zod `3.23.x`
- Auth admin : `@node-rs/argon2` `2.0.x`, `openid-client` (OIDC), cookies HMAC
- Optionnel : `ioredis` `5.10.x` (rate limit + anti-rejeu multi-replicas)
- Release : `semantic-release` `24.x`

## Commandes

### Globales (Turborepo)

- `pnpm install`
- `pnpm turbo run build` : build initial necessaire pour que `@koe/shared/dist` existe avant `pnpm dev`
- `pnpm dev`
- `pnpm typecheck`
- `pnpm lint` (soft-fail en CI, seul le widget a un script `lint` defini)
- `pnpm test` : Node `--test` sur les fichiers `packages/api/src/{lib,middleware}/*.test.ts`. Pas de vitest/jest. Pas de suites cote widget/dashboard.
- `pnpm release:dry` : verification semantic-release

### Par package

- `pnpm --filter @koe/api dev` : tsx watch
- `pnpm --filter @koe/api db:generate` puis `db:migrate` : obligatoire apres toute modif de `packages/api/src/db/schema.ts`
- `pnpm --filter @koe/api db:studio`
- `pnpm --filter @koe/api admin-user -- --email you@example.com --project-key acme` : cree un admin en mode password
- `pnpm --filter @koe/api bootstrap` : CLI interactif de creation de projet
- `pnpm --filter @koe/api hash-password '...'` : argon2id CLI
- `pnpm --filter @koe/api rotate-secrets` : rotation des `identitySecret` (schema v2 : `iat`, `nonce`, `kid`)
- `pnpm --filter @koe/dashboard dev`
- `pnpm --filter @wifsimster/koe dev`

### Lancer un test API isole

```
node --test packages/api/src/lib/identityToken.test.ts
```

## Architecture API (`packages/api`)

- `src/index.ts` : montage conditionnel. Les routes admin `/v1/admin/*` ne sont montees **que si** `ADMIN_AUTH_MODE` est defini (`password`, `oidc`, ou `dev-session`). Sans cette var, l'API admin reste off — c'est le defaut sur.
- `src/bin/` : entrypoints tsup (`serve.ts`, `migrate.ts`, `bootstrap.ts`, `hash-password.ts`, `rotate-secrets.ts`). L'image Docker expose `node dist/serve.js`, `dist/migrate.js`, `dist/bootstrap.js`.
- `src/routes/` : `widget.ts` (public), `adminApi.ts` (JSON admin), `admin.ts` (pages HTML), `passwordAuth.ts` (login email+password), `health.ts`.
- `src/middleware/` : `project.ts`, `identity.ts` (HMAC contributeurs), `cors.ts` (dynamique par projet), `rateLimit.ts`, `adminAuth.ts` (session cookie signe + garde-fous role). Pour toute route admin qui mute un ticket, toujours passer par `requireAdminSession`, `requireProjectMember`, `requireProjectWriter`, `requireProjectOwner` — ne jamais deduire l'autorisation de la seule session.
- `src/db/` : `schema.ts` (modele central), `drizzle/` contient les migrations versionnees. Regenerer + commiter la migration a chaque change de schema.
- `src/lib/` : `identityToken.ts` (token v2), `secretStore.ts` (lecture via `getSecretStoreFromEnv()` si `KOE_SECRET_KEYS` est actif), `notifications.ts` (Resend, envoi fire-and-forget a chaque nouveau ticket widget).
- Enveloppe JSON commune : toujours utiliser `ok()` et `fail()`. Valider toute entree externe avec Zod pres de la route.

### Auth admin — trois modes

- `password` : table `admin_users` (hash argon2id), login via `passwordAuth.ts`. Creer un utilisateur via CLI `admin-user`.
- `oidc` : `openid-client` contre n'importe quel provider OIDC. Vars `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_DASHBOARD_URL`, `OIDC_COOKIE_SECRET`, `OIDC_SCOPES`.
- `dev-session` : tokens bearer mintes via CLI `admin-session`. **L'API refuse de demarrer en production avec ce mode.**
- Sessions stockees en base (`admin_sessions`) sous forme de hash SHA-256 — un dump DB ne fuite pas de credentials actifs.
- Roles par projet : `owner` / `member` / `viewer` (pas un seul admin global ; le produit n'est plus mono-admin).

### Dashboard et CORS

`ENABLE_DASHBOARD` est `false` par defaut. Passer a `true` pour servir la SPA a `/admin/`. Le build Vite utilise `base=/admin/` dans le Dockerfile. `ADMIN_DASHBOARD_ORIGIN` regle le CORS si le dashboard est heberge sur une autre origine.

### Audit et actions en lot

Les mutations admin doivent emettre un evenement `admin_ticket_events` dans la **meme transaction** que la mutation. Les actions en lot correlent leurs evenements via un `batchId` commun (permet le revert).

### Notifications email (Resend)

- `src/lib/notifications.ts` expose `notifyNewTicket(row, project)`. Client Resend lazy-init via `getResendFromEnv()` : sans `RESEND_API_KEY`, retourne `null` et `notifyNewTicket` no-op silencieusement (log une fois au demarrage).
- Appele en fire-and-forget apres chaque insert reussi dans `routes/widget.ts` (bugs + features). **Jamais** `await` : le widget ne doit pas dependre de la latence/dispo de Resend. Toute erreur est logguee et swallowed.
- Destinataire resolu dans cet ordre : `NOTIFY_OWNER_EMAIL` > `ADMIN_EMAIL` > skip. Adapte a un produit self-hosted mono-fondateur. Quand les tables `admin_users` / `project_members` existeront, remplacer le resolver par un lookup `role='owner'` par projet (signature `notifyNewTicket(row, project)` deja prete).
- Expediteur : `RESEND_FROM_EMAIL` (domaine verifie dans Resend). Optionnel : `DASHBOARD_PUBLIC_URL` pour inclure un lien `/admin/tickets/:id` dans l'email.
- Tests : `src/lib/notifications.test.ts` (node --test) couvre no-op sans cle, happy path avec fake client injecte (`__setResendForTest`), fallback `ADMIN_EMAIL`, et resilience quand `send()` throw.

## Architecture widget (`packages/widget`)

- `vite.config.ts` fait une **double build** pilotee par `BUILD_TARGET` :
  - `lib` → ESM + `.d.ts` via `vite-plugin-dts` (rollupTypes inline les types `@koe/shared`)
  - `standalone` → IIFE `koe.iife.js` avec React bundle, expose `window.Koe` (`init`, `destroy`)
- Composants dans `src/components/` : `KoeWidget`, `Panel`, `Launcher`, `IntentPicker`, `BrowseList`, formulaires (`BugReportForm`, `FeatureRequestForm`), primitives UI.
- Client : `src/api/client.ts`. Context : `src/context/KoeContext.tsx`.
- Ne **jamais** casser la double build : les consommateurs pinent soit via tag git (React) soit via `<script>` autonome.

## Architecture dashboard (`packages/dashboard`)

TanStack Router, shadcn/ui sur Tailwind. Pages : `InboxPage`, `TicketDetailPage`, `OverviewPage`, `OnboardingPage`, `LoginPage`. Pas de tache `lint` definie.

## Conventions de code

- TypeScript strict (`tsconfig.base.json` : `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, target ES2022, module ESNext, moduleResolution Bundler).
- ESM partout.
- Prettier : `semi: true`, `singleQuote: true`, `trailingComma: all`, `printWidth: 100`.
- Composants React en `PascalCase.tsx`, helpers/middlewares/contextes en `camelCase.ts(x)`.
- Reutiliser `@koe/shared` avant de dupliquer un type.
- Preferer plusieurs petits middlewares Hono plutot qu'une grosse route monolithique.
- Garder les formulaires du widget simples, locaux, sans state management externe.

## Workflow git et releases

- Branche de base : `main`. Branches de travail : `claude/...`.
- **Conventional Commits** obligatoires (`feat(widget): ...`, `fix(api): ...`) — `semantic-release` les consomme. Voir `CONTRIBUTING.md` pour les impacts de release par type et l'usage de `!` / `BREAKING CHANGE:` pour un major.
- Deux pipelines de release independants sur `main` :
  - Widget (`.github/workflows/widget-release.yml`) : semantic-release, tags `vX.Y.Z`, GitHub Release avec notes auto. Pas de `CHANGELOG.md` committe. Pas de publication npm.
  - Image serveur (`.github/workflows/server-image.yml`) : declenche sur push touchant `packages/api/**`, `packages/shared/**` ou `pnpm-lock.yaml`. Tags roulants `:edge` + `:sha-*` a chaque push. Tags stables `:latest`, `:x.y.z`, `:x.y`, `:x` **uniquement** sur push d'un tag git `server-vX.Y.Z`. Multi-arch (amd64+arm64), cosign keyless, SLSA provenance, SBOM, scan Trivy (soft-fail).
- Le proxy git de l'environnement **refuse les push de tags et les suppressions de refs**. Passer par l'UI GitHub ou un poste local pour ces operations.

## Variables d'environnement cles

- `DATABASE_URL` : obligatoire, sinon l'API refuse de demarrer.
- `MIGRATE_ON_START` : `true` par defaut. Passer a `false` en multi-replicas et lancer `docker compose run --rm api migrate` avant le scale-up.
- `ENABLE_DASHBOARD` : `false` par defaut.
- `ADMIN_AUTH_MODE` : non defini = pas d'API admin (defaut sur). Sinon `password`, `oidc`, `dev-session`.
- `KOE_SECRET_KEYS` (+ `KOE_SECRET_ACTIVE_KID`) : active le chiffrement AES-256-GCM au repos des `identitySecret`. Passer par `getSecretStoreFromEnv()` — ne **jamais** stocker ces secrets en clair une fois actif.
- `REDIS_URL` : indispensable des qu'on scale au-dela d'un replica. Sans Redis, le rate limiter et l'anti-rejeu sont par-pod.
- `RESEND_API_KEY` : optionnel. Non defini = notifications email desactivees (no-op silencieux). Defini = envoi d'un email a chaque nouveau ticket widget.
- `RESEND_FROM_EMAIL` : expediteur verifie chez Resend. Requis si `RESEND_API_KEY` est defini.
- `NOTIFY_OWNER_EMAIL` : destinataire des notifications. Fallback sur `ADMIN_EMAIL` si absent.
- `DASHBOARD_PUBLIC_URL` : optionnel, base URL publique du dashboard pour inclure un lien vers le ticket dans l'email.
- `packages/api/.env.example` et `.env.docker.example` listent le reste.

## Gotchas

- `pnpm install` ne suffit pas avant `pnpm dev` : lancer d'abord `pnpm turbo run build` pour que `@koe/shared/dist` existe.
- Toute modif de deps oblige a regenerer `pnpm-lock.yaml` — la CI `--frozen-lockfile` echoue sinon.
- Ne **pas** documenter le chat temps reel comme fonctionnalite active.
- Ne **pas** ressusciter `better-auth` (abandonne au profit de `openid-client` + argon2id). Les vars `BETTER_AUTH_*` n'existent plus.
- Ne **pas** activer `ADMIN_AUTH_MODE=dev-session` en production : l'API refuse de demarrer.
- Le script `lint` du widget reference `eslint` mais aucune config eslint n'est installee — la CI tourne `lint` avec `continue-on-error: true`.
- Le `projectKey` est **public**, ce n'est pas un secret. Le vrai secret est `identitySecret`.

## Fichiers sensibles

- `packages/api/src/index.ts` — montage conditionnel des routes admin
- `packages/api/src/db/schema.ts` — regenerer migration a chaque change
- `packages/api/src/routes/widget.ts`, `routes/adminApi.ts`
- `packages/api/src/middleware/adminAuth.ts`
- `packages/api/src/lib/identityToken.ts`, `lib/secretStore.ts`, `lib/notifications.ts`
- `packages/widget/vite.config.ts` — double build
- `.github/workflows/ci.yml`, `widget-release.yml`, `server-image.yml`
- `.releaserc.json`
