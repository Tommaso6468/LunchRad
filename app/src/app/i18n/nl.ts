import type { ApiError } from '@lunchrad/shared';
import type { FinishReason } from '../core/room-connection';

/**
 * All user-facing text in one place. The app is Dutch-only; keeping strings
 * here means copy can be fixed without touching component logic.
 */
export const nl = {
  appName: 'Lunchrad',
  tagline: 'Waar gaan we lunchen?',

  teamKey: {
    title: 'Teamcode',
    intro:
      'Vul de teamcode in die je van je team hebt gekregen. Dit hoeft maar één keer op dit apparaat.',
    label: 'Teamcode',
    submit: 'Doorgaan',
  },

  create: {
    title: 'Nieuwe kamer',
    intro: 'Jij wordt de host: jij laat het rad draaien.',
    submit: 'Kamer maken',
    botCheckLoading: 'Controle laden…',
    botCheckFailed: 'De controle kon niet laden. Herlaad de pagina en probeer het opnieuw.',
    botCheckWaiting: 'Wacht tot de controle hierboven klaar is.',
  },

  join: {
    title: 'Meedoen',
    intro: 'Heb je een code gekregen? Vul hem hier in.',
    codeLabel: 'Kamercode',
    codeHint: '6 tekens, bijvoorbeeld K7Q4M0',
    submit: 'Meedoen',
    invalidCode: 'Een kamercode heeft 6 letters en cijfers.',
    joinRoomTitle: (code: string) => `Meedoen met kamer ${code}`,
  },

  nameLabel: 'Je naam',
  nameHint: 'Zo zien de anderen je. Maximaal 20 tekens.',

  room: {
    codeLabel: 'Kamercode',
    share: 'Delen',
    copied: 'Link gekopieerd',
    showQr: 'QR-code tonen',
    hideQr: 'QR-code verbergen',
    qrAlt: (code: string) => `QR-code om mee te doen met kamer ${code}`,
    shareText: (code: string) => `Doe mee met de lunchkeuze: kamer ${code}`,
    closesIn: (minutes: number) =>
      minutes <= 1 ? 'Sluit binnen een minuut' : `Sluit over ${minutes} minuten`,
    participants: (count: number) => (count === 1 ? '1 persoon' : `${count} personen`),
    host: 'host',
    you: 'jij',
    offline: 'niet verbonden',
    makeHost: (name: string) => `Maak ${name} host`,
    makeHostShort: 'Maak host',
    remove: (name: string) => `Verwijder ${name}`,
    removeShort: 'Verwijder',
    confirmRemove: (name: string) => `${name} uit de kamer verwijderen?`,
    confirmEnd: 'De kamer sluiten voor iedereen?',
    confirmLeave: 'De kamer verlaten?',
    end: 'Kamer sluiten',
    leave: 'Kamer verlaten',
    restaurantsSoon: 'Hier komen straks de restaurants en het rad.',
    connecting: 'Verbinden…',
    reconnecting: 'Verbinding kwijt. Opnieuw verbinden…',
  },

  toasts: {
    youAreHost: 'Jij bent nu de host',
    newHost: (name: string) => `${name} is nu de host`,
    kicked: (name: string) => `${name} is uit de kamer verwijderd`,
    closingSoon: 'De kamer sluit over 5 minuten',
  },

  finished: {
    title: 'Kamer gesloten',
    reasons: {
      ended: 'De host heeft de kamer gesloten.',
      expired: 'De kamer is na 30 minuten automatisch gesloten.',
      empty: 'De kamer is gesloten omdat er niemand meer was.',
      kicked: 'De host heeft je uit de kamer verwijderd.',
      left: 'Je hebt de kamer verlaten.',
      gone: 'Deze kamer bestaat niet meer.',
    } satisfies Record<FinishReason, string>,
    home: 'Naar het begin',
  },

  errors: {
    bad_request: 'Er klopt iets niet aan het verzoek. Herlaad de pagina en probeer het opnieuw.',
    unauthorized: 'Vul de teamcode opnieuw in.',
    wrong_team_key: 'Die teamcode klopt niet.',
    rate_limited: 'Te veel pogingen. Wacht een minuut en probeer het opnieuw.',
    bot_check_failed: 'De controle is mislukt. Probeer het opnieuw.',
    invalid_name: 'Gebruik 1 tot 20 letters, cijfers of spaties.',
    name_taken: 'Iemand in deze kamer heeft die naam al. Kies een andere.',
    room_full: 'Deze kamer is vol (maximaal 20 personen).',
    room_not_found: 'Deze kamer bestaat niet (meer). Controleer de code.',
    not_found: 'Niet gevonden.',
    not_configured: 'Lunchrad is nog niet klaar voor gebruik. Laat de beheerder het instellen.',
    server_error: 'Er ging iets mis. Probeer het opnieuw.',
    network: 'Geen verbinding. Controleer je internet en probeer het opnieuw.',
  } satisfies Record<ApiError | 'network', string>,
} as const;
