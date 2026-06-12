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
    headline:
      'Michał announced a new video recording for Saturday, and Henryk joined as a newcomer with access issues.',
    bullets: [
      'Grzegorz bumped the old-video question twice; Michał said he would record a new one on Saturday and publish it on the platform.',
      'Henryk Kerber (76 y/o) was welcomed; Robert explained Skool points and levels.',
      'Michał sent Henryk a test message to diagnose the access problem; there was no confirmation that it was fixed.',
      'Evening social chat: greetings, jokes, and swapping one-liners.',
      'Advice: chopped red worms in bream ground bait; tench ground-bait recommendations for cold water.',
    ],
    threads: [
      {
        topic: 'old-video-request-new-upload-plan',
        participants: ['Grzegorz', 'Michał Lotkowski', 'Adrian'],
        resolved: true,
        keyFacts: [
          'Grzegorz bumped the earlier video-material question twice.',
          'Michał confirmed the old video was from a year ago and said he would record a new one on Saturday and upload it to the platform.',
          'Adrian thanked him for the information.',
        ],
      },
      {
        topic: 'new-member-onboarding-and-platform-tips',
        participants: ['Henryk Kerber', 'Ireneusz', 'Mateusz Cichal', 'Robert', 'Zuza'],
        resolved: true,
        keyFacts: [
          'Henryk introduced himself and asked whether he could join the members.',
          'Robert explained the Skool mechanics: posts, likes, points, and levels.',
          'Members confirmed Henryk was already in the group and encouraged him to participate.',
        ],
      },
      {
        topic: 'whatsapp-access-and-skool-link-confusion',
        participants: ['Henryk Kerber', 'Mikołaj Eret', 'Michał Lotkowski', 'Mateusz Cichal'],
        resolved: false,
        keyFacts: [
          'Henryk had trouble accessing the group through WhatsApp or the Skool link.',
          'Michał sent a test message to check whether posts were visible.',
          'Henryk did not clearly confirm that the issue was resolved.',
        ],
      },
    ],
    moderatorPosts: [
      {
        time: '09:20',
        topic: 'old-video-request-new-upload-plan',
        summary:
          'Michał says the old video is from a year ago and announces a new recording on Saturday with publication on the platform.',
      },
      {
        time: '18:24',
        topic: 'whatsapp-access-and-skool-link-confusion',
        summary:
          'Michał sends Henryk a test message to check whether he can see posts and help resolve the access problem.',
      },
    ],
    openQuestions: ['Can Henryk now use WhatsApp and Skool without access problems?'],
    activityOutliers: [
      {
        sender: 'Henryk Kerber',
        messageCount: 18,
        note: 'New participant with many questions and activity across several threads: onboarding, technical access, and fishing advice.',
      },
      {
        sender: 'Robert',
        messageCount: 12,
        note: 'Above-average message volume with advice for the new member and activity in the evening chat.',
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
        notes: 'Announces the new video and coordinates technical help.',
      },
      {
        sender: 'Henryk Kerber',
        firstSeen: '2026-04-08',
        totalMessages: 18,
        activeDays: 1,
        role: 'newcomer' as const,
        notes: '76-year-old new participant with platform questions and fishing-advice requests.',
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
        summary:
          'Announcement of a new video recording on Saturday and publication on the platform.',
      },
    ],
    openThreads: [
      {
        topic: 'whatsapp-access-and-skool-link-confusion',
        openedOn: '2026-04-08',
        lastSignal: 'Michał sent a test message; Henryk has not confirmed resolution.',
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
    headline:
      'Lively discussion about fermented ground bait in cold water and the search for free depth maps.',
    bullets: [
      'Grzegorz looked for a free depth-map app; ADAM12 recommended the paid Fish Deeper app, and Mateusz noted the pond was not scanned.',
      'Hubert questioned whether ferment makes sense in mid-April; Mateusz clarified that fermentation still happens at lower temperatures, while scent diffusion is slower.',
      'Ireneusz shared a link to the relevant lesson on the platform, closing the thread.',
      'Hubert repeatedly asked Michał for a private Skool reply, with no reaction.',
    ],
    threads: [
      {
        topic: 'free-depth-maps-apps-and-deeper-availability',
        participants: ['Grzegorz', 'R', 'ADAM12', 'Mateusz Cichal'],
        resolved: false,
        keyFacts: [
          'Grzegorz looked for a free app with lake depth maps.',
          'R offered a Lowrance Hook with GPS but no maps, only a track.',
          'ADAM12 recommended the paid but inexpensive Fish Deeper app.',
          'Mateusz noted that the specific pond had not been scanned in Deeper.',
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
          'Hubert questioned whether ferment in mid-April is natural and effective.',
          'Mateusz clarified that fermentation also occurs at lower temperatures and scent diffusion in cold water is slower.',
          'Hubert acknowledged he had mixed up issues and pointed to slower carbohydrate digestion in cold water.',
          'Ireneusz shared a link to the relevant lesson on the platform.',
        ],
      },
      {
        topic: 'request-private-reply-from-michal',
        participants: ['Hubert Frąckowiak'],
        resolved: false,
        keyFacts: [
          'Hubert repeatedly asked Michał for a private reply on Skool.',
          'The request was not acknowledged in the thread.',
        ],
      },
    ],
    moderatorPosts: [],
    openQuestions: [
      "Is there a free depth-map app for Grzegorz's fishing spot?",
      'Will Michał reply privately to Hubert on Skool?',
    ],
    activityOutliers: [
      {
        sender: 'Hubert Frąckowiak',
        messageCount: 14,
        note: 'Active in the long ferment discussion and made repeated requests for private contact.',
      },
      {
        sender: 'Grzegorz',
        messageCount: 11,
        note: 'Many messages with questions, photos, and descriptions of fishing and ground bait.',
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
        notes: 'No moderator activity today; Hubert is waiting for a reply.',
      },
      {
        sender: 'Hubert Frąckowiak',
        firstSeen: '2026-04-10',
        totalMessages: 35,
        activeDays: 2,
        role: 'member' as const,
        notes: 'Rising activity; frequent requests for private contact with the moderator.',
      },
    ],
    moderatorEvents: [
      {
        date: '2026-04-08',
        topic: 'old-video-request-new-upload-plan',
        summary:
          'Announcement of a new video recording on Saturday and publication on the platform.',
      },
    ],
    openThreads: [
      {
        topic: 'free-depth-maps-apps-and-deeper-availability',
        openedOn: '2026-04-11',
        lastSignal: 'Mateusz: the specific pond has not been scanned in Deeper.',
        lastSignalDate: '2026-04-11',
      },
      {
        topic: 'request-private-reply-from-michal',
        openedOn: '2026-04-11',
        lastSignal: 'Hubert repeats the request without an answer.',
        lastSignalDate: '2026-04-11',
      },
    ],
    recentSummaryDates: ['2026-04-08', '2026-04-09', '2026-04-10', '2026-04-11'],
  },
} as const;
