# Koe

Koe vous permet d'ajouter un widget de support dans vos applications SaaS. Vos utilisateurs peuvent signaler un bug, proposer une évolution et voter sur votre roadmap sans quitter votre interface.

Le socle réellement exploitable aujourd'hui couvre le **service Koe** (API + base de données) et le **widget Koe**. Le **dashboard** existe déjà, mais il reste surtout un squelette en attente de branchement.

## Comment ça marche

Koe est constitué de **deux composants distincts** que vous devez assembler :

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

1. **Le service Koe** est un back-end que **vous hébergez une fois**. Il expose l'API publique et stocke les tickets, votes et projets dans PostgreSQL. C'est ce composant qui contient votre configuration et vos données.
2. **Le widget Koe** est un composant front-end que **vous embarquez dans chacune de vos applications SaaS**. Il appelle le service via HTTPS.
3. **Un seul service peut servir plusieurs applications.** Chaque application est rattachée à un `projectKey` distinct côté service, ce qui permet de cloisonner les données, les origines autorisées et l'identité.

Aucun service Koe hébergé n'est fourni aujourd'hui : vous devez déployer votre propre instance avant d'intégrer le widget.

## Table des matières

- [Comment ça marche](#comment-ça-marche)
- [Partie 1 — Déployer le service Koe](#partie-1--déployer-le-service-koe)
  - [Prérequis](#prérequis)
  - [Déploiement de l'API et de la base](#déploiement-de-lapi-et-de-la-base)
  - [Variables d'environnement](#variables-denvironnement)
  - [Créer un projet](#créer-un-projet)
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

### Prérequis

- Node.js `>=20`
- `pnpm@9.12.0`
- Une base PostgreSQL accessible depuis votre API (locale, managée, peu importe).

### Déploiement de l'API et de la base

Depuis la racine du monorepo :

```bash
pnpm install
cp packages/api/.env.example packages/api/.env
pnpm --filter @koe/api db:generate
pnpm --filter @koe/api db:migrate
pnpm build
pnpm --filter @koe/api start
```

Répartition recommandée pour une première mise en production :

- **API** sur Railway, Render ou Fly.io.
- **Base PostgreSQL** sur un service managé.
- **Widget React** consommé depuis vos applications via `@wifsimster/koe`.
- **Widget autonome** servi depuis votre CDN avec `style.css` et `koe.iife.js`.

### Variables d'environnement

Variables lues par l'API :

| Variable             | Obligatoire | Description                                                                    |
| -------------------- | ----------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`       | Oui         | Chaîne de connexion PostgreSQL. Sans elle, les routes DB renvoient une erreur. |
| `PORT`               | Non         | Port d'écoute HTTP. Par défaut `8787`.                                         |
| `BETTER_AUTH_SECRET` | Réservée    | Prévue pour l'intégration future de `better-auth`. Non utilisée aujourd'hui.   |
| `BETTER_AUTH_URL`    | Réservée    | Prévue pour l'intégration future de `better-auth`. Non utilisée aujourd'hui.   |

### Créer un projet

Chaque application hôte doit être rattachée à un projet Koe. **Aujourd'hui, la création se fait directement dans la table `projects`** : aucun back-office n'est encore branché.

| Champ                         | Obligatoire              | Rôle                                                        |
| ----------------------------- | ------------------------ | ----------------------------------------------------------- |
| `projectKey`                  | Oui                      | Identifie l'application qui embarque le widget.             |
| `allowedOrigins`              | Oui en production        | Liste les domaines autorisés à appeler l'API.               |
| `identitySecret`              | Recommandé               | Sert à signer `user.id` côté backend hôte.                  |
| `requireIdentityVerification` | Recommandé en production | Rend `userHash` obligatoire pour accepter une contribution. |

Points importants :

- Si `allowedOrigins` est vide, le projet reste permissif.
- Si vous avez plusieurs applications ou plusieurs domaines, **créez un projet par contexte d'usage** : même service Koe, `projectKey` distincts.
- Le `projectKey` est public. Ce n'est pas un secret. Le vrai secret est `identitySecret`.

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
| `apiUrl`     | Oui en pratique      | `https://api.koe.dev` | URL de votre service Koe. Le défaut est un placeholder. |
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
- **Dashboard** : navigation présente, mais pages encore placeholder. L'API d'administration n'est pas branchée.
- **`better-auth`** : prévu mais non câblé aujourd'hui.

## Développer ce dépôt

- `pnpm install`
- `pnpm turbo run build`
- `pnpm dev`
- `pnpm turbo run typecheck`
- `pnpm turbo run lint`
- `pnpm turbo run test`

Les commits suivent **Conventional Commits**. Consultez `CONTRIBUTING.md` pour le format attendu et le lien avec la release.

## Stack technique

- **Widget** : React 19, TypeScript, Vite, Tailwind CSS.
- **Service Koe (API)** : Hono, Zod, Drizzle ORM, PostgreSQL.
- **Monorepo** : `pnpm` workspaces et Turborepo.
- **Release** : GitHub Actions et `semantic-release` pour les tags et GitHub Releases du widget.

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
