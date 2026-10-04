# AGENTS.md

Ce fichier est la source unique des conventions pour les agents de code. Tout ce
qui suit s'applique à n'importe quel agent (Claude Code, Codex, Copilot…) qui
touche ce dépôt.

## Vue d'ensemble

Koe est un monorepo `pnpm` + Turborepo pour un widget support embarquable self-hosted destine aux produits SaaS (bugs, demandes d'evolution, vote public) et son back-office. Produit auto-heberge : aucune instance geree. Distribue sous forme d'image Docker `ghcr.io/wifsimster/koe-server` (API + dashboard bundles) et de tags git `v*` pour le widget (consomme via `github:Wifsimster/koe#vX.Y.Z` ou jsDelivr, ou via npm). Le widget (bugs, demandes d'evolution, vote) et l'API d'administration (inbox, bulk actions, audit) sont branches. Le chat temps reel existe comme onglet de preview local mais n'est pas branche.

## Packages

| Package           | Depend de     | Role                                                                       | Publication                            |
| ----------------- | ------------- | -------------------------------------------------------------------------- | -------------------------------------- |
| `@wifsimster/koe` | `@koe/shared` | Widget React (build lib ESM / npm + build IIFE autonome avec React inline) | Tags git `v*` + npm (semantic-release) |
| `@koe/api`        | `@koe/shared` | API Hono : widget public + admin JSON + auth admin (password)              | Image Docker (bundle tsup)             |
| `@koe/dashboard`  | `@koe/shared` | SPA React TanStack Router : inbox, ticket detail, overview, onboarding     | Embarquee dans l'image API (`/admin/`) |
| `@koe/shared`     | -             | Types metier et helpers transverses (`captureBrowserMetadata`, `redactUrl`, `redactText`)             | Prive au workspace                     |

## Stack et versions

- Node `>=20.8.1`, `pnpm@9.12.0`, TypeScript `5.6.x`, Turbo `2.3.x`, Prettier `3.3.x`
- React `19.x`, Vite `6.x`, Tailwind `3.4.x`, TanStack Router `1.82.x`
- Hono `4.6.x`, Drizzle ORM `0.36.x`, `postgres` `3.4.x`, Zod `3.23.x`
- Auth admin : `@node-rs/argon2` `2.0.x`, cookies HMAC
- Optionnel : `ioredis` `5.10.x` (rate limit + anti-rejeu multi-replicas)
- Release : `semantic-release` `24.x`

## Commandes

### Globales (Turborepo)

- `pnpm install`
- `pnpm turbo run build` (ou `pnpm build`) : build initial necessaire pour que `@koe/shared/dist` existe avant `pnpm dev`
- `pnpm dev`
- `pnpm typecheck`
- `pnpm lint` (soft-fail en CI, seul le widget a un script `lint` defini)
- `pnpm test` : `turbo run test`, seul `@koe/api` a un script `test` (`node --import tsx --test src/lib/*.test.ts`). Couvre uniquement `packages/api/src/lib/*.test.ts` ; seul `widgetOrigin.test.ts` exerce un middleware (`createWidgetCors`), aucun test de route. Pas de vitest/jest. Pas de suites cote widget/dashboard/shared. En CI l'etape test est en `continue-on-error`.
- `pnpm release:dry` : verification semantic-release

### Par package

- `pnpm --filter @koe/api dev` : tsx watch
- `pnpm --filter @koe/api db:generate` puis `db:migrate` : obligatoire apres toute modif de `packages/api/src/db/schema.ts`
- `pnpm --filter @koe/api db:studio`
- `pnpm --filter @koe/api bootstrap` : CLI interactif de creation de projet
- `pnpm --filter @koe/api hash-password '...'` : argon2id CLI
- `pnpm --filter @koe/api exec tsx src/bin/rotate-secrets.ts` : re-chiffrement au repos des `identitySecret` sous le kid `KOE_SECRET_ACTIVE_KID` (dry-run par defaut, `--apply` pour ecrire, `--reencrypt-all` pour une rotation de cle maitre). Pas de script `package.json` ni d'entree tsup.
- `pnpm --filter @koe/dashboard dev`
- `pnpm --filter @wifsimster/koe dev`

### Lancer un test API isole

```
pnpm --filter @koe/api exec node --import tsx --test src/lib/identityToken.test.ts
```

## Architecture API (`packages/api`)

- `src/index.ts` : montage conditionnel. Les routes admin `/v1/admin/*` ne sont montees **que si** `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` et `ADMIN_SESSION_SECRET` sont tous definis. Sans elles, l'API admin reste off — c'est le defaut sur. Une config partielle (`ADMIN_EMAIL` ou `ADMIN_PASSWORD_HASH` sans les trois) fait refuser le demarrage.
- `src/bin/` : entrypoints tsup (`serve.ts`, `migrate.ts`, `bootstrap.ts`, `hash-password.ts`) ; `rotate-secrets.ts` n'est pas bundle (lance via `tsx`). L'image Docker expose `node dist/serve.js`, `dist/migrate.js`, `dist/bootstrap.js`.
- `src/routes/` : `widget.ts` (public), `adminApi.ts` (JSON admin), `admin.ts` (pages HTML), `passwordAuth.ts` (login email+password), `health.ts`.
- `src/middleware/` : `project.ts`, `identity.ts` (HMAC contributeurs), `cors.ts` (preflight repondu depuis l'`Origin` et les headers demandes, sans cle projet ; ACAO par projet sur la vraie requete ; regles pures dans `lib/widgetOrigin.ts`), `rateLimit.ts`, `adminAuth.ts` (cookie HMAC + lookup `admin_sessions`). Le produit est **single-admin** : toute route admin passe par `requireAdmin`, et les routes scopees a un projet ajoutent `resolveProject`. Il n'y a pas de middleware `requireProjectMember/Writer/Owner` — ces roles n'existent pas dans le code (trimmes en migrations 0008/0009). Ne jamais deduire l'autorisation de la seule session : une route admin sans `requireAdmin`, ou une route scopee a un projet sans `resolveProject`, est un trou d'autorisation.
- `src/db/` : `schema.ts` (modele central), `drizzle/` contient les migrations versionnees. Regenerer + commiter la migration a chaque change de schema.
- `src/lib/` : `identityToken.ts` (token v2), `secretStore.ts` (lecture via `getSecretStoreFromEnv()` si `KOE_SECRET_KEYS` est actif), `notifications.ts` (Resend, envoi fire-and-forget a chaque nouveau ticket widget).
- Enveloppe JSON commune : toujours utiliser `ok()` et `fail()`. Valider toute entree externe avec Zod pres de la route.

### Auth admin — single-admin via env

- Single-admin : `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` (argon2id) en env. Login via `passwordAuth.ts`. Pas de table `admin_users`, pas de CLI de creation d'utilisateur. Hash genere via `pnpm --filter @koe/api hash-password '...'`.
- Sessions DB-backed : cookie HMAC envelope + lookup SHA-256 dans `admin_sessions`. Le login fait `recordAdminSession`, le logout fait `revokeAdminSession`. Un dump DB ne fuite pas de credentials actifs, et le logout invalide reellement la session cote serveur. `requireAdmin` exige une ligne `admin_sessions` vivante : sans match (logout, revoke manuel, cookie expire/forge) → 401. L'ancienne branche TOFU (qui re-inserait un cookie HMAC-valide jamais vu) a ete retiree — elle annulait le logout cote serveur ; le login persiste desormais chaque session, donc un cookie legitime a toujours sa ligne.
- Pas d'OIDC ni de mode `dev-session` / tokens bearer : retires par `acbab66` (auth admin ramenee au single-admin env). Il n'y a pas de variable `ADMIN_AUTH_MODE` : le seul flux est email + password.

### Dashboard et CORS

`ENABLE_DASHBOARD` est `false` par defaut via `docker-compose.yml` ; hors compose, le code le traite comme `true` s'il n'est pas defini. Mettre `true` pour servir la SPA a `/admin/`. Le build Vite utilise `base=/admin/` dans le Dockerfile. `ADMIN_DASHBOARD_ORIGIN` regle le CORS si le dashboard est heberge sur une autre origine.

### Audit et actions en lot

Les mutations admin doivent emettre un evenement `admin_ticket_events` dans la **meme transaction** que la mutation. Les actions en lot emettent un evenement par ticket, sans correlation (`batch_id` retire en migration 0009) ; le revert se fait evenement par evenement.

### Notifications email (Resend)

- `src/lib/notifications.ts` expose `notifyNewTicket(row, project)`. Client Resend lazy-init via `getResendFromEnv()` : sans `RESEND_API_KEY`, retourne `null` et `notifyNewTicket` no-op silencieusement (log une fois au demarrage).
- Appele en fire-and-forget apres chaque insert reussi dans `routes/widget.ts` (bugs + features). **Jamais** `await` : le widget ne doit pas dependre de la latence/dispo de Resend. Toute erreur est logguee et swallowed.
- Destinataire resolu dans cet ordre : `NOTIFY_OWNER_EMAIL` > `ADMIN_EMAIL` > skip. Adapte au modele single-admin du produit. La signature `notifyNewTicket(row, project)` prend deja le projet : si le produit reintroduit un jour des roles par projet, le resolver pourra basculer sur un lookup `role='owner'` sans changer le call site.
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
- Cote widget, privilegier des composants locaux et peu abstraits.
- Garder les formulaires du widget simples, locaux, sans state management externe.
- Lire l'implementation reelle avant de documenter ou d'etendre une fonctionnalite.
- Verifier l'impact multi-packages avant de changer `packages/shared`, `turbo.json` ou `tsconfig.base.json`.

## Workflow git et releases

- Branche de base : `main`. Branches de travail : `claude/...`.
- **Conventional Commits** obligatoires (`feat(widget): ...`, `fix(api): ...`) — `semantic-release` les consomme. Voir `CONTRIBUTING.md` pour les impacts de release par type et l'usage de `!` / `BREAKING CHANGE:` pour un major.
- CI GitHub Actions sur push et pull request vers `main`.
- Deux pipelines de release independants sur `main` :
  - Widget (`.github/workflows/widget-release.yml`) : semantic-release, tags `vX.Y.Z`, GitHub Release avec notes auto. Pas de `CHANGELOG.md` committe. Publication npm de `@wifsimster/koe` via `@semantic-release/npm` (`pkgRoot: packages/widget`, secret `NPM_TOKEN`).
  - Image serveur (`.github/workflows/server-image.yml`) : declenche sur push touchant `packages/api/**`, `packages/shared/**` ou `pnpm-lock.yaml`. Tags roulants `:edge` + `:sha-*` a chaque push. Tags stables `:latest`, `:x.y.z`, `:x.y`, `:x` **uniquement** sur push d'un tag git `server-vX.Y.Z`. Multi-arch (amd64+arm64), cosign keyless, SLSA provenance, SBOM, scan Trivy (soft-fail).
- Ne pas modifier `.github/workflows/widget-release.yml` ou `.releaserc.json` sans besoin explicite de publication.
- Le proxy git de l'environnement **refuse les push de tags et les suppressions de refs**. Passer par l'UI GitHub ou un poste local pour ces operations.

## Variables d'environnement cles

- `DATABASE_URL` : obligatoire, sinon l'API refuse de demarrer.
- `MIGRATE_ON_START` : `true` par defaut. Passer a `false` en multi-replicas et lancer `docker compose run --rm api migrate` avant le scale-up.
- `ENABLE_DASHBOARD` : `false` par defaut dans `docker-compose.yml`, `true` si non defini hors compose.
- `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` + `ADMIN_SESSION_SECRET` : les trois non definis = pas d'API admin (defaut sur). Tous definis = API admin montee. Une valeur `REPLACE_ME...` fait refuser le demarrage.
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
- Ne **pas** ressusciter `better-auth` (abandonne au profit d'argon2id + cookie HMAC). Les vars `BETTER_AUTH_*` n'existent plus.
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
