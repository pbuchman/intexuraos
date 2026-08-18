# Plan: prosta poprawka obsługi czasu trwania wydarzeń

## Cel

Intex Agent ma rozumieć jawny czas trwania wydarzenia, wyliczać godzinę zakończenia i przechodzić od razu do jednego końcowego potwierdzenia.

Jeżeli użytkownik nie poda czasu trwania ani godziny zakończenia, agent ma zastosować widoczne domyślne 60 minut w tym samym końcowym potwierdzeniu. Nie może wcześniej pytać, czy 60 minut jest w porządku.

## Oczekiwane zachowanie

1. Użytkownik podaje pełne polecenie, np. „Dodaj trening jutro o 18:00, będzie trwał dwie godziny”.
   - Agent ustawia początek na 18:00 i koniec na 20:00.
   - Agent pokazuje jedno końcowe potwierdzenie utworzenia wydarzenia.

2. Agent ma już rozpoczęty draft, a użytkownik dopowiada „Będzie trwał dwie godziny”.
   - Agent zachowuje nazwę, datę, godzinę rozpoczęcia i pozostałe znane dane draftu.
   - Zmienia tylko czas zakończenia na `start + 120 minut`.
   - Agent pokazuje jedno końcowe potwierdzenie.

3. Użytkownik nie podaje czasu trwania ani godziny zakończenia.
   - Agent przyjmuje 60 minut.
   - Pokazuje wyliczoną godzinę zakończenia w jednym końcowym potwierdzeniu.
   - Nie zadaje osobnego pytania o zaakceptowanie domyślnych 60 minut.

4. Agent nadal pyta, jeżeli brakuje danych koniecznych do wykonania operacji, takich jak nazwa, data lub godzina rozpoczęcia, albo gdy dane są ze sobą sprzeczne.

5. Brak opcjonalnej lokalizacji nie powoduje pytania.

## Zakres zmiany

### 1. Najpierw testy regresji

Dodać testy obejmujące wyłącznie następujące przypadki:

- „będzie trwał dwie godziny” w pierwszej wiadomości;
- „będzie trwał dwie godziny” jako odpowiedź do aktywnego draftu;
- zachowanie istniejących danych draftu po dopowiedzeniu czasu trwania;
- brak czasu trwania skutkujący domyślnymi 60 minutami i jednym potwierdzeniem;
- jawna sprzeczność między końcem a czasem trwania skutkująca pytaniem wyjaśniającym.

Pliki testowe:

- `apps/intex-agent/src/__tests__/domain/calendarEventReadiness.test.ts`
- `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts`

### 2. Rozpoznawanie czasu trwania

W `apps/intex-agent/src/domain/agent/intexAgentRunner.ts` rozszerzyć istniejące rozpoznawanie czasu trwania o najczęstsze naturalne formy, w tym:

- „będzie trwał dwie godziny”;
- „potrwa dwie godziny”;
- „przez dwie godziny”;
- „na 2 godziny” i „2h”;
- „na 90 minut”.

Jawny czas trwania ma być traktowany tak samo jak jawna godzina zakończenia: agent wylicza `end = start + duration` i nie pyta ponownie o `end`.

Przy odpowiedzi do aktywnego draftu należy użyć istniejącego `CalendarEventDraftV1`: zachować dotychczasowe wartości i nałożyć tylko nową, jawnie podaną korektę. Nie tworzyć nowej wersji draftu ani migracji.

### 3. Usunięcie dodatkowego pytania o 60 minut

W `apps/intex-agent/src/domain/agent/calendarEventReadiness.ts` zmienić regułę dla brakującego `end`:

- wyliczyć `start + 60 minut`;
- uznać draft za gotowy do końcowego potwierdzenia;
- nie zwracać `needs_clarification` wyłącznie z powodu domyślnego czasu trwania.

Usunąć z tej ścieżki specjalną akceptację odpowiedzi typu „tak/ok/pasuje”. Po tej zmianie nie będzie osobnego etapu zatwierdzania założenia 60 minut.

### 4. Ujednolicenie promptów z kodem

Zmienić tylko reguły dotyczące końca i czasu trwania w:

- `packages/llm-prompts/src/intex-agent/systemPrompt.ts`;
- `packages/llm-prompts/src/intex-agent/intentClassifierPrompt.ts`;
- `apps/intex-agent/src/domain/agent/toolDefinitions.ts`.

Nowa reguła:

- jawny czas trwania wystarcza do wyliczenia `end`;
- brak `end` i czasu trwania pozwala użyć widocznych domyślnych 60 minut;
- dodatkowe pytanie jest potrzebne tylko przy rzeczywistym braku wymaganych danych lub sprzeczności.

Zaktualizować testy promptów i podnieść ich wersje major zgodnie z zasadami repozytorium.

### 5. Weryfikacja

Uruchomić:

1. testy `calendarEventReadiness` i `intexAgentRunner`;
2. testy promptów Intex Agenta;
3. `pnpm run verify:workspace:tracked intex-agent`;
4. `pnpm run ci:tracked`.

## Kryteria akceptacji

- „Trening będzie trwał dwie godziny” daje czas zakończenia `start + 120 minut`.
- Dopowiedzenie czasu trwania nie zmienia nazwy, daty ani godziny rozpoczęcia istniejącego draftu.
- Brak czasu trwania daje widoczne domyślne 60 minut bez pytania pośredniego.
- Utworzenie wydarzenia nadal wymaga dokładnie jednego końcowego potwierdzenia.
- Agent pyta tylko o faktycznie brakujące wymagane dane lub sprzeczność.
- Wszystkie nowe i istniejące testy przechodzą.

## Poza zakresem

- migracje danych i nowa wersja draftu;
- nowe endpointy lub zmiany Firestore;
- przebudowa klasyfikatora;
- obsługa wielu intencji w jednej wiadomości;
- zmiany modelu LLM;
- refaktor fallbacków, telemetrii i historii sesji;
- szersze porządki w promptach niezwiązane z czasem trwania wydarzeń.

## Endpoint Changes

- Modified: none.
- Created: none.
- Removed: none.
- Existing routes remain unchanged.
