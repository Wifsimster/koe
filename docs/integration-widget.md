# Integration du widget

Ce document explique comment embarquer Koe dans une application hote. Il s'adresse aux equipes produit, frontend et integration.

## Choisir le bon mode

| Mode                | Quand l'utiliser                           | Particularite                                    |
| ------------------- | ------------------------------------------ | ------------------------------------------------ |
| **Package React**   | Votre application utilise deja React       | Vous importez `KoeWidget` et `style.css`.        |
| **Script autonome** | Vous voulez une integration sans framework | La build IIFE inclut React et expose `Koe.init`. |

## Parcours d'integration

```mermaid
flowchart LR
    A[Equipe produit] --> B[Choix du mode]
    B --> C[Application hote]
    C --> D[Configuration du widget]
    D --> E[API Koe]
```

L'equipe choisit un mode d'integration. L'application hote initialise ensuite le widget avec le bon projet et les bonnes options. Le widget appelle enfin l'API Koe.

## Configuration essentielle

| Option       | Obligatoire     | Role                                                                |
| ------------ | --------------- | ------------------------------------------------------------------- |
| `projectKey` | Oui             | Identifie le projet cible.                                          |
| `user`       | Non             | Rattache le ticket a un utilisateur connu.                          |
| `userHash`   | Selon le projet | Active la verification d'identite cote API.                         |
| `apiUrl`     | Non             | Pointe vers l'API. La valeur par defaut vise `https://api.koe.dev`. |
| `position`   | Non             | Place le lanceur dans un coin de l'ecran.                           |
| `theme`      | Non             | Regle la couleur, le mode clair ou sombre et le rayon.              |
| `features`   | Non             | Active ou masque les onglets bugs, evolutions et chat.              |
| `locale`     | Non             | Remplace les textes d'interface.                                    |
| `app`        | Non             | `{ version, release }` de l'application hote, joint a chaque rapport. |
| `capture`    | Non             | `keepQueryParams` : parametres d'URL dont la valeur est conservee ; toutes les autres valeurs sont masquees. `trail: false` desactive l'historique d'actions, de console et de requetes. |
| `captureScreenshot` | Non      | Hook appele a l'envoi d'un bug : televerse une capture sur votre stockage et renvoie son URL http(s) (`screenshotUrl`). Ignore apres 5 s ou en cas d'erreur. |

### Contexte capture et confidentialite

Chaque rapport joint l'environnement du navigateur, la version du widget (`widgetVersion`), `app`, la capacite tactile (`input`) et `user.metadata` (stocke sous `reporterMetadata`). Les rapports de bug joignent aussi l'historique recent, borne : 30 actions (clics par role et nom accessible, champs modifies sans leur contenu, navigations), 20 erreurs ou avertissements console et 20 requetes `fetch`/XHR en echec. Le widget enregistre cet historique tant qu'il est monte, en enveloppant `console.error/warn`, `fetch` et `XMLHttpRequest` ; `capture: { trail: false }` le desactive. Aucune frappe clavier n'est lue. Les valeurs de query et de hash des URL sont masquees par le widget puis a nouveau par l'API, tout comme les jetons (JWT, `Bearer`, `token=...`) et les adresses e-mail dans le texte capture.

## Exemple React

Exemple minimal pour une application React.

```tsx
import { KoeWidget } from '@wifsimster/koe';
import '@wifsimster/koe/style.css';

export function App() {
  return <KoeWidget projectKey="demo" user={{ id: 'u1', email: 'jane@example.com' }} />;
}
```

## Exemple script autonome

Exemple minimal pour une application sans framework.

```html
<link rel="stylesheet" href="https://cdn.koe.dev/style.css" />
<script src="https://cdn.koe.dev/koe.iife.js"></script>
<script>
  Koe.init({
    projectKey: 'demo',
    user: { id: 'u1', email: 'jane@example.com' },
    userHash: 'hash-fourni-par-votre-backend',
  });
</script>
```

## Points d'attention

- **Verification d'identite** : `userHash` doit venir de votre backend.
- **Styles** : la version React attend l'import de `@wifsimster/koe/style.css`.
- **Build autonome** : chargez aussi `style.css` en plus de `koe.iife.js`.
- **Chat** : l'onglet existe, mais il reste local et sans temps reel.
- **Build npm** : React est externe dans le package publie.
- **Build autonome** : React est inclus dans `koe.iife.js`.
- **Metadonnees navigateur** : le widget ajoute automatiquement le contexte utile aux bugs.
- **Onglet « My requests »** : apparait uniquement si `user.id` est renseigne et different de `anonymous`. Consomme `/v1/widget/my-requests` ; un ticket publie sur la roadmap publique affiche un lien vers `/r/:projectKey#t-<id>`.
