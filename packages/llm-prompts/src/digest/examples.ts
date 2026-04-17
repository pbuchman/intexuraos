/**
 * Few-shot examples for the WhatsApp digest prompt.
 *
 * Shape MUST match `AggregationOutputSchema`. The type is not imported here
 * to keep this package free of app dependencies; the `aggregateDigest` use case
 * validates examples against the Zod schema at runtime.
 */

/**
 * Cold-start example: day 1 with empty previous state and empty summaries window.
 */
export const COLD_START_EXAMPLE = {
  dailySummary: {
    date: '2026-04-08',
    groupKey: 'grupa-wedkarska-skool',
    messageCount: 83,
    headline: 'Michał zapowiedział nagranie nowego filmu w sobotę, a Henryk dołączył jako nowicjusz z problemami dostępowymi.',
    bullets: [
      'Grzegorz dwukrotnie podbił pytanie o stary film; Michał zapowiedział nagranie nowego w sobotę i publikację na platformie.',
      'Henryk Kerber (76 l.) został powitany; Robert wyjaśnił mu mechanikę punktów i poziomów na Skool.',
      'Michał wysłał Henrykowi testową wiadomość, aby zdiagnozować problem z dostępem — brak potwierdzenia rozwiązania.',
      'Wieczorny luz towarzyski: powitania, żarty, wymiana kawałów.',
      'Porady: cięty czerwony robak w zanęcie na leszcza; rekomendacje zanęt na lina w chłodnej wodzie.',
    ],
    threads: [
      {
        topic: 'old-video-request-new-upload-plan',
        participants: ['Grzegorz', 'Michał Lotkowski', 'Adrian'],
        resolved: true,
        keyFacts: [
          'Grzegorz dwukrotnie podbił wcześniejsze pytanie o materiał wideo.',
          'Michał potwierdził, że stary film jest sprzed roku i zapowiedział nagranie nowego w sobotę oraz wrzucenie na platformę.',
          'Adrian podziękował za informację.',
        ],
      },
      {
        topic: 'new-member-onboarding-and-platform-tips',
        participants: ['Henryk Kerber', 'Ireneusz', 'Mateusz Cichal', 'Robert', 'Zuza'],
        resolved: true,
        keyFacts: [
          'Henryk przywitał się i zapytał, czy może dołączyć do członków.',
          'Robert wyjaśnił mechanikę platformy Skool (posty, łapki, punkty, poziomy).',
          'Członkowie potwierdzili, że Henryk jest już w grupie, i zachęcali do aktywności.',
        ],
      },
      {
        topic: 'whatsapp-access-and-skool-link-confusion',
        participants: ['Henryk Kerber', 'Mikołaj Eret', 'Michał Lotkowski', 'Mateusz Cichal'],
        resolved: false,
        keyFacts: [
          'Henryk miał trudności z dostępem do grupy przez WhatsApp lub link ze Skool.',
          'Michał wysłał testową wiadomość, aby sprawdzić widoczność wpisów.',
          'Brak jednoznacznego potwierdzenia rozwiązania problemu przez Henryka.',
        ],
      },
    ],
    moderatorPosts: [
      {
        time: '09:20',
        topic: 'old-video-request-new-upload-plan',
        summary:
          'Michał informuje, że stary film jest sprzed roku i zapowiada nagranie nowego w sobotę oraz wrzucenie go na platformę.',
      },
      {
        time: '18:24',
        topic: 'whatsapp-access-and-skool-link-confusion',
        summary:
          'Michał wysyła testową wiadomość do Henryka, aby sprawdzić, czy widzi wpisy i pomóc w rozwiązaniu problemu z dostępem.',
      },
    ],
    openQuestions: ['Czy Henryk swobodnie korzysta już z platformy WhatsApp/Skool?'],
    activityOutliers: [
      {
        sender: 'Henryk Kerber',
        messageCount: 18,
        note: 'Nowy uczestnik; liczne pytania i aktywność w kilku wątkach (onboarding, dostęp techniczny, porady wędkarskie).',
      },
      {
        sender: 'Robert',
        messageCount: 12,
        note: 'Ponadprzeciętna liczba wpisów z poradami dla nowego członka oraz aktywność w czacie wieczornym.',
      },
    ],
  },
  stateUpdate: {
    userId: 'google-oauth2|113131655542389277022',
    groupKey: 'grupa-wedkarska-skool',
    updatedAt: '2026-04-08T22:00:00.000Z',
    identityLedger: [
      {
        sender: 'Michał Lotkowski',
        firstSeen: '2026-04-08',
        totalMessages: 5,
        activeDays: 1,
        role: 'moderator' as const,
        notes: 'Zapowiada nowy film, koordynuje pomoc techniczną.',
      },
      {
        sender: 'Henryk Kerber',
        firstSeen: '2026-04-08',
        totalMessages: 18,
        activeDays: 1,
        role: 'newcomer' as const,
        notes: '76-letni nowy uczestnik; pytania o platformę i porady wędkarskie.',
      },
      {
        sender: 'Robert',
        firstSeen: '2026-04-08',
        totalMessages: 12,
        activeDays: 1,
        role: 'member' as const,
      },
    ],
    moderatorEvents: [
      {
        date: '2026-04-08',
        topic: 'old-video-request-new-upload-plan',
        summary: 'Zapowiedź nagrania nowego filmu w sobotę i publikacji na platformie.',
      },
    ],
    openThreads: [
      {
        topic: 'whatsapp-access-and-skool-link-confusion',
        openedOn: '2026-04-08',
        lastSignal: 'Michał wysłał testową wiadomość; brak potwierdzenia od Henryka.',
        lastSignalDate: '2026-04-08',
      },
    ],
    recentSummaryDates: ['2026-04-08'],
  },
} as const;

/**
 * With-context example: day 4 (2026-04-11) with state + 3-day summaries window.
 * Demonstrates: thread continuation reference, open-thread carry-over,
 * identity-ledger increment, moderator-events append.
 */
export const WITH_CONTEXT_EXAMPLE = {
  dailySummary: {
    date: '2026-04-11',
    groupKey: 'grupa-wedkarska-skool',
    messageCount: 76,
    headline: 'Ożywiona dyskusja o fermentowanych zanętach w chłodnej wodzie i poszukiwanie darmowych map głębokości.',
    bullets: [
      'Grzegorz szukał darmowej aplikacji z mapami głębokości; ADAM12 polecił płatną Fish Deeper, Mateusz zaznaczył, że dany staw nie jest zeskanowany.',
      'Hubert zakwestionował sens fermentu w połowie kwietnia; Mateusz sprostował, że fermentacja zachodzi też w niższych temperaturach, a dyfuzja zapachów jest wolniejsza.',
      'Ireneusz podał link do odpowiedniej lekcji na platformie — wątek domknięty.',
      'Hubert kilkukrotnie prosił Michała o prywatną odpowiedź na Skool — bez reakcji.',
    ],
    threads: [
      {
        topic: 'free-depth-maps-apps-and-deeper-availability',
        participants: ['Grzegorz', 'R', 'ADAM12', 'Mateusz Cichal'],
        resolved: false,
        keyFacts: [
          'Grzegorz szukał darmowej aplikacji z mapami głębokości jezior.',
          'R zaoferował Lowrance Hook z GPS, ale bez map (tylko ślad).',
          'ADAM12 polecił płatną (niedrogą) aplikację Fish Deeper.',
          'Mateusz zauważył, że dany staw nie jest zeskanowany w Deeperze.',
        ],
      },
      {
        topic: 'fermented-baits-in-cold-water-suitability',
        participants: [
          'Hubert Frąckowiak',
          'Zuza',
          'Mikołaj Eret',
          'Kamilos',
          'Ireneusz',
          'Mateusz Cichal',
        ],
        resolved: true,
        keyFacts: [
          'Hubert wyraził wątpliwość, czy ferment w połowie kwietnia jest naturalny i skuteczny.',
          'Mateusz sprostował, że fermentacja zachodzi także w niższych temperaturach, a dyfuzja zapachów w zimnej wodzie jest wolniejsza.',
          'Hubert przyznał, że pomylił kwestie i wskazał na wolniejsze trawienie węglowodanów w zimnej wodzie.',
          'Ireneusz podał link do odpowiedniej lekcji na platformie.',
        ],
      },
      {
        topic: 'request-private-reply-from-michal',
        participants: ['Hubert Frąckowiak'],
        resolved: false,
        keyFacts: [
          'Hubert kilkukrotnie poprosił Michała o prywatną odpowiedź na Skool.',
          'Prośba pozostała bez potwierdzenia w wątku.',
        ],
      },
    ],
    moderatorPosts: [],
    openQuestions: [
      'Czy istnieje darmowa aplikacja z mapami głębokości dla łowiska Grzegorza?',
      'Czy Michał odpowie Hubertowi prywatnie na Skool?',
    ],
    activityOutliers: [
      {
        sender: 'Hubert Frąckowiak',
        messageCount: 14,
        note: 'Aktywny w długiej dyskusji o fermencie i wielokrotne prośby o kontakt prywatny.',
      },
      {
        sender: 'Grzegorz',
        messageCount: 11,
        note: 'Wiele wiadomości z pytaniami, zdjęciami i opisami łowienia oraz zanęt.',
      },
    ],
  },
  stateUpdate: {
    userId: 'google-oauth2|113131655542389277022',
    groupKey: 'grupa-wedkarska-skool',
    updatedAt: '2026-04-11T22:00:00.000Z',
    identityLedger: [
      {
        sender: 'Michał Lotkowski',
        firstSeen: '2026-04-08',
        totalMessages: 5,
        activeDays: 1,
        role: 'moderator' as const,
        notes: 'Brak aktywności moderatorskiej dziś; oczekuje odpowiedzi do Huberta.',
      },
      {
        sender: 'Hubert Frąckowiak',
        firstSeen: '2026-04-10',
        totalMessages: 35,
        activeDays: 2,
        role: 'member' as const,
        notes: 'Aktywność wzrostowa; częste prośby o kontakt prywatny do moderatora.',
      },
    ],
    moderatorEvents: [
      {
        date: '2026-04-08',
        topic: 'old-video-request-new-upload-plan',
        summary: 'Zapowiedź nagrania nowego filmu w sobotę i publikacji na platformie.',
      },
    ],
    openThreads: [
      {
        topic: 'free-depth-maps-apps-and-deeper-availability',
        openedOn: '2026-04-11',
        lastSignal: 'Mateusz: dany staw nie jest zeskanowany w Deeperze.',
        lastSignalDate: '2026-04-11',
      },
      {
        topic: 'request-private-reply-from-michal',
        openedOn: '2026-04-11',
        lastSignal: 'Hubert ponawia prośbę bez odpowiedzi.',
        lastSignalDate: '2026-04-11',
      },
    ],
    recentSummaryDates: ['2026-04-08', '2026-04-09', '2026-04-10', '2026-04-11'],
  },
} as const;
