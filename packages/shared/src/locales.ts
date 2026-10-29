import type { WidgetLocale } from './types/widget';
import { DEFAULT_LOCALE } from './types/widget';

export type WidgetLanguage = 'en' | 'fr' | 'es' | 'de' | (string & {});

export const LOCALES: Record<string, WidgetLocale> = {
  en: DEFAULT_LOCALE,
  fr: {
    launcherLabel: 'Support',
    title: 'Comment pouvons-nous vous aider ?',
    subtitle: 'Nous lisons chaque message.',
    picker: {
      prompt: 'Que souhaitez-vous faire ?',
      bug: 'Signaler un bug',
      bugHint: 'Quelque chose ne fonctionne pas',
      feature: 'Suggérer une idée',
      featureHint: 'Nouvelles fonctionnalités, améliorations',
      vote: 'Parcourir les idées',
      voteHint: 'Votez pour les demandes des autres utilisateurs',
      myRequests: 'Mes demandes',
      myRequestsHint: 'Suivez le statut de ce que vous avez envoyé',
    },
    browse: {
      title: 'Idées',
      loading: 'Chargement des idées…',
      empty: 'Aucune idée pour le moment — soyez le premier à en proposer une.',
      error: 'Impossible de charger les idées.',
      retry: 'Réessayer',
      voteAriaLabel: 'Voter',
      unvoteAriaLabel: 'Retirer mon vote',
      signInToVote: 'Connectez-vous pour voter',
    },
    myRequests: {
      title: 'Mes demandes',
      loading: 'Chargement de vos demandes…',
      empty: "Vous n'avez encore rien envoyé.",
      error: 'Impossible de charger vos demandes.',
      retry: 'Réessayer',
      viewOnRoadmap: 'Voir sur la roadmap',
      status: {
        open: 'Ouvert',
        in_progress: 'En cours',
        planned: 'Planifié',
        resolved: 'Livré',
        closed: 'Fermé',
        wont_fix: 'Non retenu',
      },
    },
    back: 'Retour',
    tabs: {
      bug: 'Bug',
      feature: 'Idée',
      chat: 'Chat',
    },
    bugForm: {
      title: 'Titre',
      description: "Que s'est-il passé ?",
      reproduce: 'Comment reproduire',
      expected: 'Que pensiez-vous obtenir ?',
      email: 'E-mail · facultatif',
      submit: 'Envoyer le rapport',
      success: 'Merci — votre rapport a bien été reçu.',
    },
    featureForm: {
      title: 'Titre',
      description: 'Décrivez votre idée',
      email: 'E-mail · facultatif',
      submit: 'Envoyer la demande',
      success: 'Merci pour votre suggestion !',
    },
    chat: {
      placeholder: 'Écrivez un message…',
      empty: 'Aucun message. Dites bonjour !',
      send: 'Envoyer',
    },
    errors: {
      required: 'Veuillez remplir ce champ',
      invalidEmail: 'Entrez un e-mail valide',
      network: 'Erreur réseau — vérifiez votre connexion',
      generic: "Une erreur s'est produite",
    },
  },
  es: {
    launcherLabel: 'Soporte',
    title: '¿Cómo podemos ayudarte?',
    subtitle: 'Leemos cada mensaje.',
    picker: {
      prompt: '¿Qué quieres hacer?',
      bug: 'Reportar un error',
      bugHint: 'Algo no funciona o es confuso',
      feature: 'Sugerir una idea',
      featureHint: 'Nuevas funciones, mejoras',
      vote: 'Explorar ideas',
      voteHint: 'Vota las peticiones de otros usuarios',
      myRequests: 'Mis peticiones',
      myRequestsHint: 'Sigue el estado de lo que has enviado',
    },
    browse: {
      title: 'Ideas',
      loading: 'Cargando ideas…',
      empty: 'Aún no hay ideas — sé el primero en proponer una.',
      error: 'No se pudieron cargar las ideas.',
      retry: 'Reintentar',
      voteAriaLabel: 'Votar',
      unvoteAriaLabel: 'Quitar voto',
      signInToVote: 'Inicia sesión para votar',
    },
    myRequests: {
      title: 'Mis peticiones',
      loading: 'Cargando tus peticiones…',
      empty: 'Aún no has enviado nada.',
      error: 'No se pudieron cargar tus peticiones.',
      retry: 'Reintentar',
      viewOnRoadmap: 'Ver en la hoja de ruta',
      status: {
        open: 'Abierta',
        in_progress: 'En curso',
        planned: 'Planificada',
        resolved: 'Lanzada',
        closed: 'Cerrada',
        wont_fix: 'No se hará',
      },
    },
    back: 'Atrás',
    tabs: {
      bug: 'Error',
      feature: 'Idea',
      chat: 'Chat',
    },
    bugForm: {
      title: 'Título',
      description: '¿Qué ha pasado?',
      reproduce: 'Cómo reproducirlo',
      expected: '¿Qué esperabas?',
      email: 'Correo · opcional',
      submit: 'Enviar reporte',
      success: 'Gracias — hemos recibido tu reporte.',
    },
    featureForm: {
      title: 'Título',
      description: 'Describe tu idea',
      email: 'Correo · opcional',
      submit: 'Enviar petición',
      success: '¡Gracias por la sugerencia!',
    },
    chat: {
      placeholder: 'Escribe un mensaje…',
      empty: 'Aún no hay mensajes. ¡Saluda!',
      send: 'Enviar',
    },
    errors: {
      required: 'Por favor rellena este campo',
      invalidEmail: 'Introduce un correo válido',
      network: 'Error de red — comprueba tu conexión',
      generic: 'Algo salió mal',
    },
  },
  de: {
    launcherLabel: 'Support',
    title: 'Wie können wir helfen?',
    subtitle: 'Wir lesen jede Nachricht.',
    picker: {
      prompt: 'Was möchten Sie tun?',
      bug: 'Fehler melden',
      bugHint: 'Etwas funktioniert nicht oder ist verwirrend',
      feature: 'Idee vorschlagen',
      featureHint: 'Neue Funktionen, Verbesserungen',
      vote: 'Ideen durchstöbern',
      voteHint: 'Stimmen Sie für Anfragen anderer Nutzer',
      myRequests: 'Meine Anfragen',
      myRequestsHint: 'Verfolgen Sie den Status Ihrer Einreichungen',
    },
    browse: {
      title: 'Ideen',
      loading: 'Ideen werden geladen…',
      empty: 'Noch keine Ideen — schlagen Sie als Erster eine vor.',
      error: 'Ideen konnten nicht geladen werden.',
      retry: 'Erneut versuchen',
      voteAriaLabel: 'Abstimmen',
      unvoteAriaLabel: 'Stimme entfernen',
      signInToVote: 'Zum Abstimmen anmelden',
    },
    myRequests: {
      title: 'Meine Anfragen',
      loading: 'Ihre Anfragen werden geladen…',
      empty: 'Sie haben noch nichts eingereicht.',
      error: 'Ihre Anfragen konnten nicht geladen werden.',
      retry: 'Erneut versuchen',
      viewOnRoadmap: 'In der Roadmap ansehen',
      status: {
        open: 'Offen',
        in_progress: 'In Bearbeitung',
        planned: 'Geplant',
        resolved: 'Veröffentlicht',
        closed: 'Geschlossen',
        wont_fix: 'Wird nicht umgesetzt',
      },
    },
    back: 'Zurück',
    tabs: {
      bug: 'Fehler',
      feature: 'Idee',
      chat: 'Chat',
    },
    bugForm: {
      title: 'Titel',
      description: 'Was ist passiert?',
      reproduce: 'Wie nachzustellen',
      expected: 'Was haben Sie erwartet?',
      email: 'E-Mail · optional',
      submit: 'Bericht senden',
      success: 'Danke — Ihr Bericht ist eingegangen.',
    },
    featureForm: {
      title: 'Titel',
      description: 'Beschreiben Sie Ihre Idee',
      email: 'E-Mail · optional',
      submit: 'Anfrage senden',
      success: 'Danke für den Vorschlag!',
    },
    chat: {
      placeholder: 'Nachricht eingeben…',
      empty: 'Noch keine Nachrichten. Sagen Sie hallo!',
      send: 'Senden',
    },
    errors: {
      required: 'Bitte füllen Sie dieses Feld aus',
      invalidEmail: 'Geben Sie eine gültige E-Mail-Adresse ein',
      network: 'Netzwerkfehler — prüfen Sie Ihre Verbindung',
      generic: 'Etwas ist schiefgelaufen',
    },
  },
};

function normalizeLanguageTag(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const base = tag.trim().toLowerCase().split(/[-_]/)[0];
  return base && base.length >= 2 ? base : null;
}

export function resolveLocale(language: string | null | undefined): WidgetLocale {
  const code = normalizeLanguageTag(language);
  const preset = code ? LOCALES[code] : undefined;
  return preset ?? DEFAULT_LOCALE;
}

export function detectBrowserLanguage(): string | null {
  if (typeof document !== 'undefined') {
    const htmlLang = document.documentElement?.lang;
    const fromHtml = normalizeLanguageTag(htmlLang);
    if (fromHtml) return fromHtml;
  }
  if (typeof navigator !== 'undefined') {
    const navLang = navigator.language || navigator.languages?.[0];
    const fromNav = normalizeLanguageTag(navLang ?? null);
    if (fromNav) return fromNav;
  }
  return null;
}
