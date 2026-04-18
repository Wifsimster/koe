# Koe

Koe vous permet d'ajouter un widget de support dans vos applications SaaS. Vos utilisateurs peuvent signaler un bug, proposer une évolution et voter sur votre roadmap sans quitter votre interface.

Koe est **self-hosted** : il n'existe pas d'instance gérée. Vous déployez le **service Koe** (API + PostgreSQL) une fois, puis vous embarquez le **widget Koe** dans une ou plusieurs applications.

## Comment ça marche

```mermaid
graph LR
    subgraph "Vos applications SaaS"
        A1[App A + Widget Koe]
        A2[App B + Widget Koe]
    end
    subgraph "Votre instance Koe (self-hosted)"
        S[Service Koe - API Hono]
        DB[(PostgreSQL)]
    end
    A1 -->|HTTPS| S
    A2 -->|HTTPS| S
    S --> DB
```

1. **Le service Koe** est un back-end que **vous hébergez une fois**. Il est distribué sous forme d'image Docker `ghcr.io/wifsimster/koe-server`. Il expose l'API publique et stocke les tickets, votes et projets dans PostgreSQL.
2. **Le widget Koe** est un composant front-end que **vous embarquez dans chacune de vos applications SaaS**. Il appelle le service via HTTPS.
3. **Un seul service peut servir plusieurs applications.** Chaque application est rattachée à un `projectKey` distinct côté service, ce qui permet de cloisonner les données, les origines autorisées et l'identité.

## Table des matières

- [Comment ça marche](#comment-ça-marche)
- [Partie 1 — Déployer le service Koe](#partie-1--déployer-le-service-koe)
  - [Démarrage rapide avec Docker Compose](#démarrage-rapide-avec-docker-compose)
  - [Image Docker](#image-docker)
  - [Variables d'environnement](#variables-denvironnement)
  - [Dashboard admin](#dashboard-admin)
  - [Créer un projet](#créer-un-projet)
  - [Exécution sans Docker](#exécution-sans-docker)
- [Partie 2 — Intégrer le widget Koe](#partie-2--intégrer-le-widget-koe)
  - [Intégration React](#intégration-react)
  - [Intégration sans framework](#intégration-sans-framework)
  - [Options du widget](#options-du-widget)
  - [Vérification d'identité](#vérification-didentité)
- [Ce qui est disponible aujourd'hui](#ce-qui-est-disponible-aujourdhui)
- [Développer ce dépôt](#développer-ce-dépôt)
- [Stack technique](#stack-technique)
- [Documentation complémentaire](#documentation-complémentaire)
- [Licence](#licence)

## Partie 1 — Déployer le service Koe

Cette partie concerne **l'administrateur de l'instance Koe**. Elle décrit comment faire tourner l'API et la base qui reçoivent les contributions du widget.

### Démarrage rapide avec Docker Compose

Le dépôt fournit un `docker-compose.yml` prêt à l'emploi qui monte l'API + PostgreSQL + volumes persistants + healthchecks. Trois commandes suffisent pour une instance fonctionnelle :

```bash
curl -O https://raw.githubusercontent.com/Wifsimster/koe/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/Wifsimster/koe/main/.env.docker.example
docker compose up -d
```

Créez ensuite un premier projet via le CLI embarqué :

```bash
docker compose run --rm api bootstrap
```

Le CLI vous demande un nom, un `projectKey`, des origines autorisées, puis génère un `identitySecret` aléatoire et affiche les valeurs à copier dans votre application.

Points clés :

- Les migrations s'appliquent automatiquement au démarrage de l'API (`MIGRATE_ON_START=true`). Pour un déploiement multi-réplicas, passez à `false` et lancez `docker compose run --rm api migrate` avant de scaler.
- Les données PostgreSQL vivent dans un volume nommé `koe-db-data` ; `docker compose down` sans `-v` les préserve.
- Par défaut l'API est exposée sur `http://localhost:8787`. Ajustez `KOE_SERVER_PORT` dans `.env` pour changer le port hôte.

### Image Docker

L'image officielle est publiée sur GitHub Container Registry :

```
ghcr.io/wifsimster/koe-server
```

| Tag           | Disponibilité                  | Usage                                                      |
| ------------- | ------------------------------ | ---------------------------------------------------------- |
| `edge`        | Chaque push sur `main`         | Dernier `main`. Utile pour tester les correctifs rapides.  |
| `sha-<short>` | Chaque push sur `main`         | Commit précis, immuable. Utile pour les rollbacks.         |
| `latest`      | Sur push d'un tag `server-v*`  | Dernière release stable. Pas de pinning. À éviter en prod. |
| `x.y.z`       | Sur push d'un tag `server-v*`  | Release exacte. **Recommandé en production.**              |
| `x.y`         | Sur push d'un tag `server-v*`  | Dernière version patch de la mineure `x.y`.                |

Les tags stables n'existent qu'après le push d'un tag git `server-vX.Y.Z`. Tant qu'aucun tag `server-v*` n'a été poussé, seuls `:edge` et `:sha-<short>` sont disponibles — c'est pourquoi `KOE_SERVER_TAG=edge` est le défaut de `.env.docker.example`.

Les images sont **multi-architecture** (`linux/amd64`, `linux/arm64`), signées via Sigstore cosign (keyless, OIDC GitHub), publiées avec une attestation de provenance SLSA et un SBOM. Un scan Trivy tourne à chaque release ; il remonte ses findings dans l'onglet Security sans bloquer la publication.

L'image expose trois commandes :

| Commande              | Rôle                                                     |
| --------------------- | -------------------------------------------------------- |
| `node dist/serve.js`  | Démarre l'API (défaut). Applique les migrations au boot. |
| `node dist/migrate.js`| Applique les migrations puis sort. À utiliser en prod multi-réplicas. |
| `node dist/bootstrap.js` | CLI interactif qui crée un projet.                   |

Exécution manuelle (sans compose) :

```bash
docker run --rm -p 8787:8787 \
  -e DATABASE_URL=postgres://user:pass@host:5432/koe \
  ghcr.io/wifsimster/koe-server:latest
```

### Variables d'environnement

| Variable                 | Obligatoire | Description                                                                                                                              |
| ------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | Oui         | Chaîne de connexion PostgreSQL. Sans elle, l'API refuse de démarrer.                                                                     |
| `PORT`                   | Non         | Port d'écoute HTTP. Par défaut `8787`.                                                                                                   |
| `HOST`                   | Non         | Interface d'écoute. Par défaut `0.0.0.0`.                                                                                                |
| `MIGRATE_ON_START`       | Non         | `true` (défaut) applique les migrations au boot. `false` en multi-réplicas.                                                              |
| `ENABLE_DASHBOARD`       | Non         | `false` (défaut). Passer à `true` pour servir la SPA d'administration sur `/admin/`.                                                     |
| `ADMIN_AUTH_MODE`        | Non         | Monte l'API admin `/v1/admin/*`. Valeurs : `password`, `oidc`, `dev-session`. Non défini : pas d'API admin (défaut sûr).                 |
| `ADMIN_DASHBOARD_ORIGIN` | Non         | Origine CORS de la SPA admin. À laisser vide en déploiement mono-origine (dashboard servi par la même API).                              |
| `OIDC_*`                 | En mode OIDC | `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_DASHBOARD_URL`, `OIDC_COOKIE_SECRET`, `OIDC_SCOPES`. |
| `ADMIN_SESSION_COOKIE`   | Non         | Nom du cookie de session admin. Par défaut `koe_admin`.                                                                                  |
| `ADMIN_SESSION_TTL_DAYS` | Non         | Durée de vie du cookie en jours. Par défaut `30`.                                                                                        |
| `ADMIN_COOKIES_SECURE`   | Non         | `true` (défaut). Passer à `false` uniquement en développement HTTP local.                                                                |
| `KOE_SECRET_KEYS`        | Non         | Active le chiffrement au repos des secrets d'identité (AES-256-GCM enveloppé). Format `kid:base64,kid2:base64`.                          |
| `KOE_SECRET_ACTIVE_KID`  | Si `KOE_SECRET_KEYS` | `kid` utilisé pour chiffrer les nouveaux secrets. Les autres `kid` restent acceptés pour le déchiffrement pendant la rotation. |
| `REDIS_URL`              | Multi-réplicas | Rate limiter et cache anti-rejeu des tokens. Indispensable dès qu'il y a plus d'un réplica API.                                       |

### Dashboard admin

Le dashboard est **embarqué dans l'image mais désactivé par défaut**. Pour un déploiement complet avec administration, il faut activer deux flags distincts :

| Flag                                    | Rôle                                                              |
| --------------------------------------- | ----------------------------------------------------------------- |
| `ENABLE_DASHBOARD=true`                 | Sert la SPA à `/admin/`.                                          |
| `ADMIN_AUTH_MODE=password` ou `oidc`    | Monte l'API JSON d'administration à `/v1/admin/*` avec auth.      |

Trois modes d'authentification sont disponibles :

- **`password`** : email + mot de passe (argon2id). Les utilisateurs sont créés via le CLI `docker compose run --rm api admin-user --email … --project-key …`.
- **`oidc`** : login via n'importe quel fournisseur OpenID Connect (Auth0, Clerk, Keycloak, Google, WorkOS, etc.). Configure les variables `OIDC_*`.
- **`dev-session`** : tokens bearer mintés via le CLI `admin-session`. Refusé en production. Pratique pour le local et le staging.

Points d'attention :

- Sans `ADMIN_AUTH_MODE`, l'API admin n'est pas montée : c'est le défaut sûr. Aucune route `/v1/admin/*` n'existe.
- Sans `ENABLE_DASHBOARD`, la SPA n'est pas servie : vous pouvez utiliser l'API admin depuis un front hébergé ailleurs en renseignant `ADMIN_DASHBOARD_ORIGIN`.
- Les sessions sont stockées en base (`admin_sessions`) sous forme de hash SHA-256 ; un dump DB ne fuite pas de credentials actifs.

### Créer un projet

Chaque application hôte doit être rattachée à un projet Koe. Le CLI `bootstrap` gère la création :

```bash
docker compose run --rm api bootstrap
```

Mode non-interactif (pour scripts / infra-as-code) :

```bash
docker compose run --rm \
  -e KOE_PROJECT_NAME="Acme Web" \
  -e KOE_PROJECT_KEY=acme-web \
  -e KOE_ALLOWED_ORIGINS="https://app.acme.com,https://staging.acme.com" \
  -e KOE_REQUIRE_IDENTITY_VERIFICATION=true \
  api bootstrap --non-interactive
```

Champs gérés :

| Champ                         | Obligatoire              | Rôle                                                        |
| ----------------------------- | ------------------------ | ----------------------------------------------------------- |
| `projectKey`                  | Oui                      | Identifie l'application qui embarque le widget.             |
| `allowedOrigins`              | Oui en production        | Liste des domaines autorisés à appeler l'API.               |
| `identitySecret`              | Généré par le CLI        | Sert à signer `user.id` côté backend hôte.                  |
| `requireIdentityVerification` | Recommandé en production | Rend `userHash` obligatoire pour accepter une contribution. |

Points importants :

- Si `allowedOrigins` est vide, le projet reste permissif.
- Si vous avez plusieurs applications ou plusieurs domaines, **créez un projet par contexte d'usage** : même service Koe, `projectKey` distincts.
- Le `projectKey` est public. Ce n'est pas un secret. Le vrai secret est `identitySecret`.

### Exécution sans Docker

Pour développer localement ou si vous préférez ne pas utiliser Docker, la chaîne pnpm reste disponible :

```bash
pnpm install
cp packages/api/.env.example packages/api/.env
pnpm --filter @koe/api db:generate
pnpm --filter @koe/api db:migrate
pnpm build
pnpm --filter @koe/api start
```

## Partie 2 — Intégrer le widget Koe

Cette partie concerne **le développeur d'une application SaaS** qui veut brancher le widget sur son front. Elle suppose qu'un service Koe est déjà déployé et qu'un projet a été créé avec un `projectKey`.

Avant d'intégrer le widget, récupérez auprès de votre administrateur Koe :

- le **`projectKey`** de votre application,
- l'**`apiUrl`** de l'instance Koe (ex. `https://api.support.acme.com`),
- l'**`identitySecret`** si votre projet exige la vérification d'identité.

### Intégration React

Le mode React est le plus simple si votre application utilise déjà React.

```tsx
import { KoeWidget } from '@wifsimster/koe';
import '@wifsimster/koe/style.css';

export function AppShell({ currentUser, koeUserHash }) {
  return (
    <>
      <Routes />
      <KoeWidget
        projectKey="acme-web"
        apiUrl="https://api.support.acme.com"
        user={{
          id: currentUser.id,
          name: currentUser.name,
          email: currentUser.email,
          metadata: { plan: currentUser.plan },
        }}
        userHash={koeUserHash}
        position="bottom-right"
        theme={{ accentColor: '#4f46e5', mode: 'auto' }}
      />
    </>
  );
}
```

Bonnes pratiques :

- Montez `KoeWidget` une seule fois, près de la racine de votre application.
- Importez `@wifsimster/koe/style.css`, sinon le widget ne sera pas stylé.
- Renseignez **toujours** `apiUrl` : le service Koe est self-hosted, il n'existe pas d'instance par défaut.
- Fournissez un `user.id` stable. Sans cela, le widget retombe sur `anonymous`.

### Intégration sans framework

Le mode autonome convient à une application non React, à une page marketing ou à une intégration via balise `<script>`.

```html
<link rel="stylesheet" href="https://cdn.votre-domaine.com/koe/style.css" />
<script src="https://cdn.votre-domaine.com/koe/koe.iife.js"></script>
<script>
  Koe.init({
    projectKey: 'acme-web',
    apiUrl: 'https://api.support.acme.com',
    user: {
      id: 'user_123',
      name: 'Jane Doe',
      email: 'jane@example.com',
    },
    userHash: 'hash-fourni-par-votre-backend',
  });
</script>
```

Points importants :

- Chargez **les deux assets** : `style.css` et `koe.iife.js`.
- La build autonome expose `window.Koe` avec `init()` et `destroy()`.
- Cette build embarque React. Vous n'avez pas besoin de React dans l'application hôte.

### Options du widget

| Option       | Obligatoire          | Valeur par défaut     | Usage                                                    |
| ------------ | -------------------- | --------------------- | -------------------------------------------------------- |
| `projectKey` | Oui                  | -                     | Rattache le widget au bon projet côté service.           |
| `apiUrl`     | Oui en pratique      | `https://api.koe.dev` | URL de votre service Koe. Le défaut est un placeholder.  |
| `user`       | Non, mais recommandé | `anonymous`           | Identifie le contributeur dans les tickets et les votes. |
| `userHash`   | Selon le projet      | -                     | Prouve l'identité du contributeur.                       |
| `position`   | Non                  | `bottom-right`        | Place le lanceur dans un coin de l'écran.                |
| `theme`      | Non                  | indigo, mode `auto`   | Règle couleur, mode et rayon.                            |
| `features`   | Non                  | toutes activées       | Active ou masque les onglets bugs, évolutions et chat.   |
| `locale`     | Non                  | anglais               | Remplace les textes d'interface.                         |

### Vérification d'identité

La vérification d'identité évite qu'un tiers usurpe un utilisateur en réutilisant seulement le `projectKey`.

Le principe est simple :

1. Votre backend génère un HMAC à partir de `user.id` et de `identitySecret`.
2. Votre frontend passe ce hash au widget via `userHash`.
3. Le widget envoie automatiquement `X-Koe-User-Hash` au service Koe.
4. Le service Koe recalcule le hash attendu avant d'accepter la requête.

Exemple backend :

```ts
import { createHmac } from 'node:crypto';

const userHash = createHmac('sha256', process.env.KOE_IDENTITY_SECRET)
  .update(user.id)
  .digest('hex');
```

À retenir :

- Ne construisez jamais `userHash` dans le navigateur.
- Si `requireIdentityVerification` vaut `true`, un hash absent ou faux renvoie `401`.
- Le `projectKey` reste public. Le vrai secret est `identitySecret`.

## Ce qui est disponible aujourd'hui

- **Bugs** : fonctionnels, avec métadonnées navigateur et `screenshotUrl`.
- **Demandes d'évolution** : fonctionnelles.
- **Votes** : fonctionnels sur la roadmap publique.
- **Chat** : onglet visible, mais conversation encore locale et sans temps réel.
- **Dashboard admin** : inbox des tickets, détail, modifications de statut/priorité, assignation, commentaires internes, actions en lot (bulk) et revert par `batchId`. Trois modes d'authentification branchés : `password`, `oidc`, `dev-session`. Invitation de membres par projet (`owner` / `member` / `viewer`).
- **Rotation des secrets d'identité** : CLI `rotate-secrets` avec schéma v2 (signature liée à `iat`, `nonce`, `kid`). Permet un renouvellement sans casser les intégrations existantes.
- **Chiffrement des secrets au repos** : AES-256-GCM enveloppé, activable via `KOE_SECRET_KEYS`.

## Développer ce dépôt

- `pnpm install`
- `pnpm turbo run build`
- `pnpm dev`
- `pnpm turbo run typecheck`
- `pnpm turbo run lint`
- `pnpm turbo run test`

Pour reconstruire l'image Docker en local (au lieu de tirer celle de GHCR) :

```bash
docker build -f packages/api/Dockerfile -t koe-server:local .
```

Les commits suivent **Conventional Commits**. Consultez `CONTRIBUTING.md` pour le format attendu et le lien avec la release.

## Stack technique

- **Widget** : React 19, TypeScript, Vite, Tailwind CSS.
- **Service Koe (API)** : Hono, Zod, Drizzle ORM, PostgreSQL. Auth admin via `openid-client` (OIDC) et argon2id (`@node-rs/argon2`). Redis optionnel (ioredis) pour rate limiting et anti-rejeu. Bundlé avec tsup et publié en image Docker multi-arch.
- **Dashboard** : React 19, TanStack Router, shadcn/ui sur Tailwind CSS.
- **Monorepo** : `pnpm` workspaces et Turborepo.
- **Release** : deux pistes indépendantes sur `main`. Widget via `semantic-release` (tags `v*` + GitHub Releases). Image serveur via workflow `Server image` (tags roulants `:edge` + `:sha-*` à chaque push, tags stables `:latest` + `:x.y.z` sur push d'un tag git `server-v*`).

## Documentation complémentaire

| Document                                                 | Description                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Intégration du widget](docs/integration-widget.md)      | Modes React et script autonome, options de configuration et points d'attention. |
| [Vérification d'identité](docs/verification-identite.md) | Flux HMAC entre le backend hôte, le widget et le service Koe.                   |
| [API widget](docs/api-widget.md)                         | Routes publiques, headers requis et limites du service Koe.                     |
| [Schéma de base de données](docs/schema-base-donnees.md) | Tables centrales, votes et éléments préparés pour le chat.                      |
| [Statut du dashboard](docs/statut-dashboard.md)          | État réel du back-office et parties encore placeholder.                         |
| [Release](docs/release-npm.md)                           | Pipeline CI/CD et création des GitHub Releases.                                 |

## Licence

MIT.
