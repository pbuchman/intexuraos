# OpenRouter-only AI access — plan wdrożenia produkcyjnego

**Status:** zatwierdzony po niezależnym review — PASS
**Data:** 2026-08-18
**Zakres:** aktywne wywołania AI aplikacji, ustawienia klucza, Research, embeddings, obrazy, usage i konfiguracja runtime

## Cel

Wszystkie nowe wywołania modeli wykonywane przez aplikację mają korzystać wyłącznie z OpenRouter. Użytkownik może podać własny klucz OpenRouter; gdy go nie poda, aplikacja używa istniejącego klucza platformowego `INTEXURAOS_OPENROUTER_APP_API_KEY`.

Zmiana ma uprościć system bez przepisywania danych historycznych. Historyczne Research pozostają źródłem prawdy o modelach rzeczywiście użytych w danym uruchomieniu, także gdy model nie jest już dostępny.

## Oczekiwany rezultat

- Jedyny wykonywalny provider aplikacji to OpenRouter.
- Nowe identyfikatory wykonywalne i telemetryczne mają format `or:<author>/<model>`; istniejące publiczne lub zapisane aliasy embeddings/images pozostają bez zmian dla kompatybilności.
- Ustawienia pokazują jeden klucz: OpenRouter.
- Research pokazuje selektor OpenRouter jako jedyny i główny selektor modeli.
- Można wybrać maksymalnie 6 różnych modeli OpenRouter, niezależnie od autora modelu.
- Synteza używa wyłącznie jawnie dopuszczonych modeli OpenRouter.
- Embeddings i obrazy korzystają z API OpenRouter bez zmiany istniejących publicznych i zapisanych aliasów modeli.
- Historyczne modele pozostają widoczne z nazwą, providerem/autorem, surowym ID i statusem dostępności.
- Nie powstaje żadna migracja Firestore ani backfill.

## Decyzje upraszczające

1. **Jeden resolver klucza:** klucz OpenRouter użytkownika, w przeciwnym razie klucz platformowy.
2. **Jeden transport:** tekst, chat, research, tool calling, embeddings i obrazy przechodzą przez `@intexuraos/infra-openrouter`.
3. **Dwie klasy modeli:** wykonywalne modele OpenRouter oraz dowolne historyczne identyfikatory tylko do odczytu.
4. **Brak automatycznej zamiany historii:** model zapisany w Research nie jest normalizowany ani podmieniany podczas odczytu.
5. **Brak reindeksacji embeddings:** zapisany alias pozostaje `text-embedding-3-small`, model wykonywalny/telemetryczny to `or:openai/text-embedding-3-small`, body OpenRouter otrzymuje `openai/text-embedding-3-small`, a wymiar pozostaje 1536.
6. **Brak nowych endpointów:** upraszczamy istniejące kontrakty.
7. **Jeden PR i jedno wdrożenie aplikacji:** bez feature flagi i bez workflow Firestore.
8. **Kompatybilność image-service:** publiczne aliasy `gpt-image-1`/`gpt-4.1` oraz zapisany alias obrazu `gpt-image-1` pozostają bez zmian; adapter mapuje je odpowiednio na wykonywalne `or:openai/...` i surowe modele OpenRouter `openai/...`.

## Poza zakresem

- Usuwanie historycznych kluczy OpenAI, Anthropic, Perplexity lub Google z dokumentów użytkowników.
- Przepisywanie `selectedModels`, `synthesisModel`, `llmResults`, `partialFailure` albo historycznych zdarzeń usage.
- Modyfikowanie istniejących migracji, w tym migracji `130`.
- Usuwanie historycznych providerów i cenników z ekranu Usage.
- Fizyczne kasowanie pakietów `infra-gpt`, `infra-claude` i `infra-perplexity`; wystarczy odłączyć je od aktywnego runtime.
- Usuwanie sekretu OpenAI z Secret Manager/Terraform w tym wdrożeniu; pozostaje czasowo dla prostego rollbacku, ale nowy kod go nie używa.
- Tokeny i autoryzacja runtime workerów Codex/Claude oraz inne integracje niebędące API LLM aplikacji.
- Zmiana modeli, wymiaru wektorów, formatu obrazów albo zachowania biznesowego niezwiązanego z transportem.

## Dotknięte funkcjonalności i właściciele kodu

| Funkcjonalność | Konieczne miejsca | Zakres zmiany |
| --- | --- | --- |
| Kontrakt modeli | `packages/llm-contract/src/supportedModels.ts`, `types.ts`, `index.ts` | OpenRouter jako jedyny wykonywalny provider; stare modele pozostają rozpoznawalne tylko jako dane historyczne |
| Fabryka LLM | `packages/llm-factory/src/llmClientFactory.ts`, `index.ts` | Usunięcie wykonywalnego dispatchu do OpenAI/Anthropic/Perplexity |
| OpenRouter | `packages/infra-openrouter/src/client.ts`, `types.ts`, `index.ts`, nowe małe adaptery embeddings/images | Jeden zestaw timeoutów, retry, błędów i usage |
| Rozwiązywanie klucza | `packages/internal-clients/src/user-service/client.ts`, `types.ts` | Tylko `openrouter`; użytkownik → platforma |
| Ustawienia użytkownika | `apps/user-service/src/routes/llmKeysRoutes.ts`, `internalRoutes.ts`, `infra/llm/LlmValidatorImpl.ts` | Odczyt, zapis, test i usunięcie wyłącznie klucza OpenRouter |
| UI ustawień | `apps/web/src/pages/ApiKeysSettingsPage.tsx`, `hooks/useLlmKeys.ts`, `services/llmKeysApi*` | Jedna karta klucza; default/fallback tylko z katalogu OpenRouter |
| Research backend | `apps/research-agent/src/infra/llm/LlmAdapterFactory.ts`, `routes/researchRoutes.ts`, `routes/internalRoutes.ts`, `routes/helpers/*`, `routes/schemas/*`, `domain/research/usecases/extractModelPreferences.ts` | Jeden klucz, jeden adapter, wiele modeli rozróżnianych po ID |
| Research frontend | `apps/web/src/components/ModelSelector.tsx`, `OpenRouterModelSelector.tsx`, `pages/research/*`, `components/research/*`, `services/researchAgentApi.types.ts` | OpenRouter pierwszy i jedyny; poprawne historyczne etykiety, retry i Enhance |
| Prompty Research | `packages/llm-prompts/src/research/modelExtractionPrompt.ts` | Lista aktywnych modeli OpenRouter; deduplikacja po ID; bump wersji promptu |
| Embeddings Code Agent | `apps/code-agent/src/services/factories/llmFactory.ts`, `domain/models/executionMemory.ts`, `config.ts`, `index.ts`, `services/types.ts` | OpenRouter embeddings; zapisany alias i wymiar bez zmian |
| Embeddings Fishing | `apps/fishing-assistant-service/src/infra/llm/embeddingClient.ts`, `domain/usecases/indexKnowledgePage.ts`, `services.ts`, `config.ts`, `index.ts` | OpenRouter embeddings; zapisany alias bez zmian; usunięcie aktywnego klienta OpenAI |
| Obrazy | `apps/image-service/src/serviceFactory.ts`, `application/generatePrompt.ts`, `application/generateImage.ts`, `routes/schemas/*`, `domain/models/*`, adaptery w `infra/` | Prompt i obraz przez OpenRouter; publiczne i zapisane aliasy bez zmian |
| Okładka Research | `apps/research-agent/src/domain/research/usecases/runSynthesis.ts` oraz route/helper plumbing wywołujące image-service | Usunięcie bramki `imageApiKeys.openai`; image-service sam wybiera OpenRouter BYOK/platformę |
| Usage | `packages/llm-pricing/src/usageLogger.ts`, `buildUsageEvent.ts`, `apps/llm-usage-service/src/domain/models/usageEvent.ts`, `routes/schemas/usageEventSchema.ts` | Obowiązkowe usage embeddings; nowe zdarzenia `provider=openrouter`; historia bez zmian |
| WhatsApp fallback | `apps/whatsapp-service/src/services.ts`, `config.ts`, `index.ts` | Przekazanie platformowego klucza OpenRouter do klienta user-service |
| Runtime | `ecosystem.config.cjs`, `ecosystem.config.prod.cjs`, wymagane env w Code/Fishing/Image/WhatsApp | OpenRouter dla dotkniętych usług; brak aktywnego wymagania OpenAI |

Moduły już korzystające z OpenRouter — Intex Agent, Message Digest, Calendar, Linear, Hellscript, Web Agent, Code Agent tool calling i Fishing chat — nie dostają zmian funkcjonalnych. Powinny zmienić się wyłącznie wtedy, gdy wymusi to zawężony wspólny typ albo test kontraktowy. WhatsApp Conversation Assistant wymaga tylko podania istniejącego platformowego fallbacku OpenRouter; jego funkcje biznesowe pozostają bez zmian.

## Polityka danych historycznych

### Research

- `storedModelSchema` pozostaje zwykłym `string` w odpowiedziach list/detail.
- `FirestoreResearchRepository` przestaje normalizować identyfikatory modeli przy odczycie.
- Zachowujemy dokładnie wartości, które są obecnie zapisane. Nie próbujemy odwracać wcześniejszych migracji ani odtwarzać wartości, których nie ma już w dokumentach.
- Historyczne `model` i `provider` z `llmResults` pozostają bez zmian.
- Frontend otrzymuje jeden czysty resolver prezentacyjny zwracający:
  - dokładne zapisane ID,
  - czytelną nazwę,
  - autora/providera,
  - `available: true/false`.
- Resolver najpierw używa aktywnego katalogu, potem znanej mapy historycznej, następnie bezpiecznie wyprowadza nazwę ze sluga; zawsze pokazuje także surowe ID.
- Model spoza aktualnej allowlisty jest widoczny jako **Unavailable**, lecz nie może zostać ponownie wykonany.
- Retry niedostępnego modelu jest blokowany przed wywołaniem LLM.
- Enhance zachowuje skopiowane wyniki historyczne i uruchamia tylko nowe, wybrane modele OpenRouter.

### Preferencje użytkownika

- Stare `defaultModel` i `fallbackModel` mogą być mapowane wyłącznie na granicy odczytu ustawień, ponieważ są konfiguracją wykonawczą, a nie historią.
- Mapa jest jawna i testowana: znany odpowiednik OpenRouter albo `DEFAULT_PLATFORM_LLM_MODEL`, gdy odpowiednika nie ma w aktywnej allowliście.
- Mapa nie wykonuje writebacku do Firestore.
- Wszystkie nowe zapisy preferencji wymagają aktywnego `or:*`.

### Pozostałe dane

- Stare zaszyfrowane klucze pozostają w dokumentach, ale publiczne API ich nie zwraca, a runtime ich nie odczytuje.
- Historyczne usage zachowuje pierwotny provider i model.
- Persisted `embeddingModel` pozostaje dokładnie `text-embedding-3-small`; nowe wektory mają nadal wymiar 1536 i są odczytywane przez istniejące filtry bez reindeksacji.
- Publiczny i persisted model obrazu pozostaje `gpt-image-1`, a publiczny model promptu `gpt-4.1`; prefiks `or:` istnieje tylko w warstwie wykonania i telemetrycznej.
- Istniejące obrazy i embeddings pozostają bez zmian.

## Endpoint Changes

### Modified

- `GET /users/:uid/settings/llm-keys`
  - zwraca zamaskowany klucz OpenRouter i jego wynik testu;
  - zwraca `accessSource: "user" | "platform" | "unavailable"`; nie ujawnia platformowego sekretu;
  - default/fallback zawierają wyłącznie aktywne modele OpenRouter po normalizacji odczytu;
  - nie eksponuje historycznych kluczy providerów.
- `PATCH /users/:uid/settings/llm-keys`
  - przyjmuje wyłącznie `provider: "openrouter"`.
- `POST /users/:uid/settings/llm-keys/:provider/test`
  - dopuszcza wyłącznie `openrouter`.
- `DELETE /users/:uid/settings/llm-keys/:provider`
  - dopuszcza wyłącznie `openrouter`;
  - usuwa tylko BYOK i jego wynik testu;
  - nie czyści poprawnych preferencji `or:*`; kolejne wykonanie natychmiast używa klucza platformowego.
- `PATCH /users/:uid/settings` dla preferencji LLM
  - nowe default/fallback muszą należeć do aktywnej listy OpenRouter.
- `GET /internal/users/:uid/llm-keys`
  - nowi konsumenci używają wyłącznie pola `openrouter`;
  - legacy pola mogą pozostać w surowej odpowiedzi przez czas rolling deployu, ale nie są częścią nowego typu klienta.
- Zapisy i akcje Research: create, draft/update/approve, confirm/retry oraz enhance
  - nowe wykonanie przyjmuje wyłącznie aktywne modele OpenRouter;
  - limit 6 unikalnych ID;
  - synteza tylko przez OpenRouter.
- `GET /research/openrouter/models`
  - pozostaje źródłem aktywnego katalogu;
  - zwraca kolejność: modele rekomendowane, pozostałe modele allowlisty.

### Created

- Brak.

### Removed

- Brak.

### Unchanged

- URL-e i kształt odpowiedzi list/detail Research; historyczne pola model/provider nadal są zwykłymi stringami.
- Endpointy image-service; zmienia się wyłącznie adapter transportowy.
- Publiczne aliasy modeli image-service (`gpt-image-1`, `gpt-4.1`) i sposób ich zapisu.
- Endpointy agentów korzystających ze wspólnego klienta.
- Endpointy Usage i historyczne projekcje providerów; istniejący schemat ingest otrzymuje tylko addytywną operację `embedding`.

## Plan implementacji

Każde zadanie zaczyna się od testu, który potwierdza brak oczekiwanego zachowania, a kończy testami dotkniętego workspace.

### 1. Zawęzić kontrakt wykonywalnych modeli

- [ ] Napisać testy kontraktu: nowe wykonania akceptują tylko `or:*`; dowolny zapisany model historyczny pozostaje czytelny.
- [ ] Zawęzić `ExecutableLlmProvider` i listę providerów konfigurowalnych do OpenRouter.
- [ ] Zawęzić default/fallback i aktywny `ResearchModel` do aktualnych modeli OpenRouter.
- [ ] Zachować stare stałe/model/provider wyłącznie dla historii, prezentacji i historycznego usage.
- [ ] Wprowadzić jedną jawną listę modeli OpenRouter dopuszczonych do syntezy; platformowy model jest pierwszy i domyślny.
- [ ] Sprawić, aby `llm-factory` odrzucał bezpośredni model zamiast tworzyć klienta bezpośredniego providera.
- [ ] Usunąć z publicznego `llm-factory/index.ts` eksporty `createClaudeGenerateClient`, `createGptGenerateClient` i `createPerplexityGenerateClient`, gdy ich callery zostaną odłączone.
- [ ] Nie usuwać pakietów direct-provider w tym zadaniu.

**Akceptacja:** żadna publiczna funkcja tworząca nowego klienta LLM nie potrafi wykonać bezpośredniego modelu OpenAI/Anthropic/Perplexity/Google.

### 2. Uzupełnić transport OpenRouter

- [ ] Dodać testy HTTP dla embeddings i images: request, odpowiedź, timeout, retry oraz 401/402/429/5xx.
- [ ] Dodać mały klient embeddings dla `/api/v1/embeddings`.
- [ ] Dodać mały klient obrazów dla `/api/v1/images`.
- [ ] Użyć tych samych nagłówków, logowania, kategorii błędów i usage co istniejący klient OpenRouter.
- [ ] Dla embeddings jawnie mapować: persisted alias `text-embedding-3-small` → executable/evidence ID `or:openai/text-embedding-3-small` → body OpenRouter `openai/text-embedding-3-small`.
- [ ] Zachować wymiar embeddings 1536 i istniejącą semantykę batch/single; test integracyjny ma potwierdzić zgodność nowego wektora ze starym indeksem i filtrem po persisted aliasie.
- [ ] Dla obrazu jawnie mapować: publiczny/persisted alias `gpt-image-1` → executable/evidence ID `or:openai/gpt-image-1` → body OpenRouter `openai/gpt-image-1`.
- [ ] Dla promptu jawnie mapować: publiczny alias `gpt-4.1` → executable/evidence ID `or:openai/gpt-4.1` → body OpenRouter `openai/gpt-4.1`.
- [ ] Zachować obecne opcje obrazu oraz dodać test: kontrakt publiczny → request OpenRouter → zapisany alias bez prefiksu.
- [ ] Prompt do obrazu generować przez istniejący tekstowy klient OpenRouter, bez osobnego adaptera GPT.

**Akceptacja:** testy adapterów potwierdzają zgodność wymiaru wektorów, persisted aliasów i formatu obrazu, a każde nowe zdarzenie ma `provider=openrouter` i pełne ID `or:*`.

### 3. Uprościć klucze i preferencje

- [ ] Napisać testy dla dwóch ścieżek: własny klucz OpenRouter oraz fallback na klucz platformowy.
- [ ] Zawęzić `DecryptedApiKeys` nowego klienta wewnętrznego do `openrouter`.
- [ ] Usunąć z `getLlmClient()` mapowanie model → provider → osobny klucz.
- [ ] Zawęzić walidator, publiczne schematy i operacje CRUD klucza do OpenRouter.
- [ ] Nie usuwać zapisanych legacy pól z repozytorium ani dokumentów.
- [ ] Dodać testowaną normalizację wyłącznie starych preferencji default/fallback, bez writebacku.
- [ ] Zmienić DELETE BYOK: usuwa klucz i test, pozostawia default/fallback `or:*`, a następne wykonanie używa platformowego fallbacku; pokryć cały przebieg testem.
- [ ] Uprościć ekran ustawień do jednej karty OpenRouter.
- [ ] Dodać `accessSource` do istniejącej odpowiedzi i pokazać źródło dostępu: własny klucz, dostęp platformowy albo brak dostępu, bez ujawniania platformowego sekretu.
- [ ] Grupować modele default/fallback według autora modelu, nie według credential providera.

**Akceptacja:** użytkownik bez własnego klucza może korzystać z dostępu platformowego; użytkownik z BYOK używa własnego klucza; usunięcie BYOK nie kasuje preferencji i przełącza na platformę; żadna aktywna operacja nie prosi o klucz OpenAI/Anthropic/Perplexity.

### 4. Uprościć nowe Research

- [ ] Napisać testy selekcji 2–6 modeli OpenRouter i odrzucenia duplikatów/nieallowlistowanych ID.
- [ ] Usunąć bezpośrednie modele z request schemas; pozostawić luźne schemas odpowiedzi historycznych.
- [ ] W backendzie zawsze pobierać `apiKeys.openrouter` i zawsze tworzyć `OpenRouterAdapter`.
- [ ] Usunąć regułę `seenProviders`; deduplikować po pełnym model ID.
- [ ] Zbudować dostępne modele do ekstrakcji preferencji z katalogu OpenRouter.
- [ ] Zaktualizować keywords/defaults oraz podnieść wersję `modelExtractionPrompt`.
- [ ] Zawęzić syntezę do centralnej listy OpenRouter.
- [ ] Zastąpić osobne karty providerów jednym selektorem OpenRouter.
- [ ] Pokazać kolejno: wybrane, rekomendowane, pozostałe modele; zachować wyszukiwanie i limit 6.
- [ ] Uprościć stan `useResearchAgent`: jedna lista wybranych ID zamiast mapy providerów plus osobnej listy OpenRouter.
- [ ] Zmienić tekst „one model per provider” na „up to 6 models”.

**Akceptacja:** nowe Research, draft i approve zapisują tylko aktualne `or:*`; OpenRouter jest jedynym i pierwszym selektorem.

### 5. Poprawić historię, Retry i Enhance bez migracji

- [ ] Napisać testy dla znanego starego modelu, nieznanego modelu i wycofanego `or:*`.
- [ ] Usunąć normalizację identyfikatorów modeli z read-path `FirestoreResearchRepository`.
- [ ] Dodać jeden resolver prezentacyjny i użyć go na liście, stronie szczegółów, wynikach, statusie przetwarzania i w Enhance.
- [ ] Pokazywać czytelną nazwę, autora/providera, surowe ID i badge **Unavailable**.
- [ ] Ujednolicić frontendową kontrolę retry z backendową allowlistą.
- [ ] Blokować retry/proceed dla niedostępnego modelu przed wywołaniem LLM i zwracać jednoznaczny komunikat.
- [ ] W Enhance blokować tylko konkretne ID już użyte, nie cały provider `openrouter`.
- [ ] Przekazać katalog OpenRouter do Enhance i pozwolić dodać kilka nowych modeli do limitu 6.
- [ ] Kopiować historyczne wyniki bez zmiany `model` i `provider`.
- [ ] Dla niedostępnego historycznego modelu syntezy wymagać wyboru aktualnego modelu OpenRouter w nowym/enhanced Research.
- [ ] Używać model ID jako klucza kart wyników React; nie używać `provider`, bo wszystkie nowe wyniki mają `openrouter`.

**Akceptacja:** otwarcie starego Research nie wykonuje żadnego zapisu; wszystkie zapisane modele są widoczne; niedostępny model nie może zostać uruchomiony; Enhance działa z wieloma modelami OpenRouter.

### 6. Przełączyć tylko bezpośrednich konsumentów

- [ ] Code Agent execution-memory embeddings przełączyć na klienta OpenRouter; usunąć aktywny `OpenAI` i `openaiAppApiKey` z jego serwisów/configu.
- [ ] Fishing knowledge embeddings przełączyć na klienta OpenRouter; zachować model i wymiar; usunąć `openAiClient` z kontenera.
- [ ] Image service przełączyć na OpenRouter prompt + image; zachować publiczny kontrakt i zapisane obrazy.
- [ ] W `runSynthesis` i powiązanym route/helper plumbing usunąć warunek `imageApiKeys.openai`; Research zawsze zleca okładkę image-service, a image-service sam wybiera OpenRouter BYOK → platforma.
- [ ] Research usunąć aktywny dispatch do `ClaudeAdapter`, `GptAdapter` i `PerplexityAdapter`; pliki mogą pozostać nieużywane.
- [ ] User-service usunąć aktywne walidatory bezpośrednich providerów.
- [ ] WhatsApp przekazać `platformOpenRouterApiKey` do wewnętrznego klienta user-service przez `services.ts`, `config.ts`, `index.ts` i oba pliki ecosystem; nie zmieniać logiki rozmów.
- [ ] Zaktualizować `package.json` Code/Fishing/Image i lockfile tylko tam, gdzie rzeczywiście zmieniły się importowane pakiety; bez porządkowania innych zależności.
- [ ] Nie edytować agentów już zgodnych poza zmianami wymaganymi przez typy/testy.
- [ ] Rozszerzyć istniejący verifier architektury tak, aby aplikacje nie mogły ponownie importować bezpośredniego klienta LLM/embeddings/images.

**Akceptacja:** wyszukiwanie i verifier CI nie znajdują aktywnych bezpośrednich wywołań API modeli w `apps/`; użytkownik WhatsApp bez BYOK korzysta z platformowego OpenRouter; Research generuje okładkę bez klucza OpenAI.

### 7. Usage i runtime

- [ ] Bezwarunkowo dodać operację `embedding` do `CallType`, domenowego `UsageEvent`, schematu ingest i testów; nie zmieniać starych zdarzeń.
- [ ] Dla każdego logicznego requestu embedding emitować dokładnie jedno zdarzenie success albo failure z `provider=openrouter`, evidence ID `or:openai/text-embedding-3-small`, tokenami, czasem i kosztem provider-reported, gdy jest dostępny.
- [ ] Pokryć telemetrię testami zarówno Code Agent execution-memory, jak i Fishing knowledge indexing, oraz testem przyjęcia zdarzenia przez llm-usage-service.
- [ ] Wszystkie pozostałe nowe zdarzenia zapisują `provider=openrouter`, pełne evidence ID `or:*` i koszt raportowany przez OpenRouter, gdy jest dostępny.
- [ ] Zachować obsługę historycznych providerów i ich pricing.
- [ ] Dodać `INTEXURAOS_OPENROUTER_APP_API_KEY` do runtime Fishing i Image.
- [ ] Przekazać istniejący `INTEXURAOS_OPENROUTER_APP_API_KEY` także do WhatsApp jako platformowy fallback.
- [ ] Usunąć aktywne wymaganie `INTEXURAOS_OPENAI_APP_API_KEY` z Code i Fishing.
- [ ] Zaktualizować `apps/<service>/src/index.ts`, konfigurację dev oraz oba pliki ecosystem zgodnie z regułą env vars; pozostawić `scripts/hetzner/load-secrets.sh` i retained secret OpenAI bez zmian na potrzeby rollbacku.
- [ ] Nie usuwać sekretu OpenAI z retained Secret Manager/Terraform w tym wdrożeniu.

**Akceptacja:** wszystkie dotknięte usługi startują bez klucza OpenAI, a z kluczem OpenRouter; rollback starego SHA nadal ma dostęp do zachowanego sekretu.

### 8. Weryfikacja i dostarczenie na produkcję

- [ ] Uruchomić testy pakietów i workspace po każdym zadaniu.
- [ ] Uruchomić `pnpm run verify:workspace:tracked -- <workspace>` dla każdego dotkniętego workspace.
- [ ] Uruchomić pełne `pnpm run ci:tracked` i zapisać wynik.
- [ ] Przed merge potwierdzić ważność, saldo i limity klucza platformowego OpenRouter.
- [ ] Przed wdrożeniem wykonać tylko do odczytu kontrolę liczby Research będących w toku ze starymi modelami; poczekać na ich zakończenie albo wdrożyć dopiero po ich bezpiecznym wygaśnięciu. Niczego nie przepisywać.
- [ ] Smoke przedprodukcyjny:
  - ustawienia z BYOK i bez BYOK;
  - default/fallback;
  - Research z 2 i 6 modelami, synteza, draft/approve;
  - historyczny Research z nieznanym i wycofanym modelem;
  - retry zablokowany dla wycofanego modelu;
  - Enhance dodający kilka modeli OpenRouter;
  - Code/Fishing embeddings wraz z persisted aliasem `text-embedding-3-small` i usage `operation=embedding`;
  - generowanie promptu i obrazu;
  - okładka Research bez klucza OpenAI;
  - WhatsApp użytkownika bez BYOK z platformowym fallbackiem;
  - po jednym reprezentatywnym wywołaniu Intex/WhatsApp/Message Digest/Calendar/Linear.
- [ ] Otworzyć jeden PR do `development`; nie uruchamiać migracji Firestore.
- [ ] Po merge poczekać na zwykły deploy Hetzner i zweryfikować `deployment.json` oraz health endpointy.
- [ ] W produkcji potwierdzić realne wywołania Research, embeddings i image oraz nowe usage z `provider=openrouter`.
- [ ] Monitorować 401, 402, 429, 5xx, timeouty, saldo, koszt i latencję OpenRouter.

## Rollback

1. Wdrożyć poprzedni produkcyjny SHA albo revertować PR.
2. Nie wykonywać rollbacku Firestore — wdrożenie nie zmienia danych historycznych ani schematu.
3. Stare zaszyfrowane klucze i retained OpenAI secret pozostają dostępne dla poprzedniej wersji.
4. Jeśli problem dotyczy jednego modelu OpenRouter, najpierw usunąć go z aktywnej allowlisty i użyć platformowego defaultu; nie zmieniać historii Research.

## Kryteria końcowe

- [ ] W `apps/` nie ma aktywnego bezpośredniego wywołania API OpenAI, Anthropic, Perplexity ani Google dla funkcji objętych planem.
- [ ] Wszystkie nowe modele wykonywalne mają `or:*` i przechodzą przez allowlistę.
- [ ] Publiczne/persisted aliasy embeddings i image pozostają bez prefiksu, a ich execution/usage używa jawnego `or:*`.
- [ ] Publiczne ustawienia obsługują wyłącznie OpenRouter.
- [ ] Research pokazuje OpenRouter jako jedyny selektor i pozwala wybrać do 6 unikalnych modeli.
- [ ] Historyczny Research zachowuje i pokazuje dokładne zapisane model/provider bez writebacku.
- [ ] Niedostępny historyczny model nie jest wykonywany ponownie.
- [ ] Istniejące embeddings pozostają kompatybilne bez reindeksacji.
- [ ] Istniejące obrazy, usage i klucze historyczne nie są przepisywane.
- [ ] Pełne CI, smoke i produkcyjne health checks przechodzą.
- [ ] Nie uruchomiono żadnej migracji Firestore.

## Review record

- 2026-08-18 — niezależny reviewer: `CHANGES_REQUIRED`.
- Wprowadzone korekty blokujące:
  1. DELETE BYOK zachowuje preferencje i przełącza na platformowy OpenRouter.
  2. Rozdzielono persisted alias, execution/evidence ID i body modelu dla embeddings.
  3. Rozdzielono publiczny/persisted alias, execution/evidence ID i body modelu dla image-service.
  4. Usage embeddings jest obowiązkowe, nie opcjonalne.
  5. WhatsApp otrzymuje platformowy fallback OpenRouter.
  6. Okładka Research nie zależy od `imageApiKeys.openai`.
- Dodatkowo doprecyzowano read-only kontrolę aktywnych Research, publiczne eksporty fabryki i konkretne pliki persisted model/usage.
- 2026-08-18 — ponowny pełny review po korektach: `PASS`, brak blockerów.
- Przyjęta uwaga nieblokująca: mechanicznie zaktualizować manifesty Code/Fishing/Image i lockfile tylko w zakresie zmienionych zależności.
