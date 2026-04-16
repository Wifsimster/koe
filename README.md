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

1. **Le service Koe** est un back-end que **vous hébergez une fois**. Il est distribué sous forme d'image Docker `ghcr.io/wifsimster/koe-api`. Il expose l'API publique et stocke les tickets, votes et projets dans PostgreSQL.
2. **Le widget Koe** est un composant front-end que **vous embarquez dans chacune de vos applications SaaS**. Il appelle le service via HTTPS.
3. **Un seul service peut servir plusieurs applications.** Chaque application est rattachée à un `projectKey` distinct côté service, ce qui permet de cloisonner les données, les origines autorisées et l'identité.

## Table des matières

- [Comment ça marche](#comment-ça-marche)
- [Partie 1 — Déployer le service Koe](#partie-1--déployer-le-service-koe)
  - [Démarrage rapide avec Docker Compose](#démarrage-rapide-avec-docker-compose)
  - [Image Docker](#image-docker)
  - [Variables d'environnement](#variables-denvironnement)
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
- Par défaut l'API est exposée sur `http://localhost:8787`. Ajustez `KOE_API_PORT` dans `.env` pour changer le port hôte.

### Image Docker

L'image officielle est publiée sur GitHub Container Registry :

```
ghcr.io/wifsimster/koe-api
```

| Tag           | Usage                                                      |
| ------------- | ---------------------------------------------------------- |
| `latest`      | Dernière release stable. Pas de pinning. À éviter en prod. |
| `x.y.z`       | Release exacte. **Recommandé en production.**              |
| `x.y`         | Dernière version patch de la mineure `x.y`.                |
| `edge`        | Build de `main`. Utile pour tester les correctifs rapides. |
| `sha-<short>` | Commit précis, immuable. Utile pour les rollbacks.         |

Les images sont **multi-architecture** (`linux/amd64`, `linux/arm64`), signées via Sigstore cosign (keyless, OIDC GitHub), publiées avec une attestation de provenance SLSA et un SBOM. Elles sont scannées à chaque release par Trivy (le build échoue sur tout CVE HIGH/CRITICAL disposant d'un correctif).

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
  ghcr.io/wifsimster/koe-api:latest
```

### Variables d'environnement

| Variable             | Obligatoire | Description                                                                    |
| -------------------- | ----------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`       | Oui         | Chaîne de connexion PostgreSQL. Sans elle, l'API refuse de démarrer.           |
| `PORT`               | Non         | Port d'écoute HTTP. Par défaut `8787`.                                         |
| `HOST`               | Non         | Interface d'écoute. Par défaut `0.0.0.0`.                                      |
| `MIGRATE_ON_START`   | Non         | `true` (défaut) applique les migrations au boot. `false` en multi-réplicas.    |
| `ENABLE_DASHBOARD`   | Non         | `true` (défaut) expose le dashboard admin à `/admin/`. Mettre `false` pour exposition publique sans auth proxy. |
| `BETTER_AUTH_SECRET` | Réservée    | Prévue pour l'intégration future de `better-auth`. Non utilisée aujourd'hui.   |
| `BETTER_AUTH_URL`    | Réservée    | Prévue pour l'intégration future de `better-auth`. Non utilisée aujourd'hui.   |

### Dashboard admin

Le dashboard est **embarqué dans l'image et activé par défaut**. Après `docker compose up`, ouvrez `http://localhost:8787/admin/`.

Points d'attention :

- Le dashboard est encore **un squelette** : la navigation fonctionne, mais les pages affichent des placeholders tant que l'API d'administration n'est pas branchée.
- Il n'y a **pas encore d'authentification** native (`better-auth` est prévu mais non câblé). Pour une exposition publique, mettez votre propre reverse-proxy avec auth devant `/admin/*`, ou désactivez le dashboard avec `ENABLE_DASHBOARD=false`.
- Désactiver le flag retire toutes les routes `/admin/*` (elles répondent `404` dans l'enveloppe JSON commune).

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
- **Dashboard** : navigation présente, mais pages encore placeholder. L'API d'administration n'est pas branchée. Servi à `/admin/` par défaut dans l'image Docker (sans auth — couvrir d'un reverse-proxy ou désactiver pour une exposition publique).
- **`better-auth`** : prévu mais non câblé aujourd'hui.

## Développer ce dépôt

- `pnpm install`
- `pnpm turbo run build`
- `pnpm dev`
- `pnpm turbo run typecheck`
- `pnpm turbo run lint`
- `pnpm turbo run test`

Pour reconstruire l'image Docker en local (au lieu de tirer celle de GHCR) :

```bash
docker build -f packages/api/Dockerfile -t koe-api:local .
```

Les commits suivent **Conventional Commits**. Consultez `CONTRIBUTING.md` pour le format attendu et le lien avec la release.

## Stack technique

- **Widget** : React 19, TypeScript, Vite, Tailwind CSS.
- **Service Koe (API)** : Hono, Zod, Drizzle ORM, PostgreSQL. Bundlé avec tsup et publié en image Docker multi-arch.
- **Monorepo** : `pnpm` workspaces et Turborepo.
- **Release** : GitHub Actions + `semantic-release` (widget, tags `v*`) + build Docker déclenché sur tags `api-v*` (image de l'API).

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
