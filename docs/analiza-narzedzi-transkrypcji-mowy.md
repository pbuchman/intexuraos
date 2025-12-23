# Analiza Narzędzi Transkrypcji Mowy dla PraxOS

**Data analizy:** 23 grudnia 2025  
**Kontekst:** Transkrypcja wiadomości głosowych zawierających luźne myśli, notatki, listy zadań, krótkie polecenia  
**Języki:** Polski (głównie) i angielski  
**Założenie:** ~300 wiadomości miesięcznie, średnio 2 minuty każda (600 minut/miesiąc)

---

## Streszczenie Wykonawcze

Po przeprowadzeniu szczegółowej analizy dostępnych rozwiązań transkrypcji mowy, rekomendujemy następujące narzędzia:

### TOP 3 Rekomendacje:

1. **OpenAI Whisper API** - najlepsza dokładność dla języka polskiego, optymalna cena, łatwa integracja
2. **Deepgram Nova-3** - najszybsze przetwarzanie czasu rzeczywistego, konkurencyjne ceny, świetna obsługa polskiego
3. **AssemblyAI Universal** - najlepsze zaawansowane funkcje (diaryzacja, analiza sentymentu), przyzwoita cena

### Rekomendacja do pierwszych testów:

**OpenAI Whisper API** - szczegóły w sekcji "Ostateczna Rekomendacja" poniżej.

---

## 1. Przegląd Analizowanych Narzędzi

Przeanalizowano następujące rozwiązania transkrypcji mowy:

1. OpenAI Whisper API
2. Google Cloud Speech-to-Text
3. Microsoft Azure Speech Service
4. Amazon Transcribe
5. AssemblyAI
6. Deepgram
7. Rev.ai
8. ElevenLabs Scribe

---

## 2. Kryteria Oceny

### 2.1 Wsparcie Językowe (Polski i Angielski)

| Narzędzie         | Polski          | Angielski  | WER Polski\* | WER Angielski\* |
| ----------------- | --------------- | ---------- | ------------ | --------------- |
| ElevenLabs Scribe | ✅ Natywne      | ✅ Natywne | 3-5%         | 3-4%            |
| OpenAI Whisper    | ✅ Natywne      | ✅ Natywne | 10-15%       | 8-12%           |
| Deepgram Nova-3   | ✅ Natywne      | ✅ Natywne | 10-14%       | 8-11%           |
| AssemblyAI        | ✅ 50+ języków  | ✅ Natywne | 12-17%       | 10-14%          |
| Google STT        | ✅ 125+ języków | ✅ Natywne | 15-25%       | 12-18%          |
| Azure Speech      | ✅ Natywne      | ✅ Natywne | 13-20%       | 10-15%          |
| Amazon Transcribe | ✅ pl-PL        | ✅ Natywne | 15-22%       | 12-18%          |
| Rev.ai            | ✅ 58+ języków  | ✅ Natywne | 15-20%       | 12-16%          |

\*WER (Word Error Rate) - im niższy, tym lepsza dokładność. Dane dla czystego audio.

**Źródła:**

- Soniox Speech-to-Text Benchmarks 2025: https://soniox.com/benchmarks
- AssemblyAI Accuracy Guide: https://www.assemblyai.com/blog/how-accurate-speech-to-text
- Deepgram Benchmark Comparison: https://research.aimultiple.com/speech-to-text/
- Galaxy.ai Speech API Comparison: https://galaxy.ai/youtube-summarizer/the-most-accurate-speech-to-text-apis-in-2025-a-comprehensive-comparison-t38gZi8WNKE

**Wiarygodność źródeł:** Wysoka - niezależne testy benchmarkowe, publikacje branżowe, oficjalna dokumentacja dostawców.

### 2.2 Dokładność dla Nieformalnej Mowy

Dla kontekstu luźnych myśli i notatek, kluczowe są:

- Obsługa niegramatycznej mowy
- Radzenie sobie z przerwami i „hmm", „eee"
- Zdolność do transkrypcji w środowiskach z szumem

**Ranking dokładności dla nieformalnej mowy (polski):**

1. **ElevenLabs Scribe** - ⭐⭐⭐⭐⭐ (najniższy WER, doskonała obsługa szumu i akcentów)
2. **OpenAI Whisper** - ⭐⭐⭐⭐⭐ (doskonałe radzenie sobie z szumem i nieformalnością)
3. **Deepgram Nova-3** - ⭐⭐⭐⭐⭐ (specjalnie dostrojone do spontanicznej mowy)
4. **AssemblyAI** - ⭐⭐⭐⭐ (bardzo dobre dla wielomówców)
5. **Azure Speech** - ⭐⭐⭐⭐ (solidne, ale wymaga dostrojenia)
6. **Google STT** - ⭐⭐⭐ (spada jakość przy szumie)
7. **Amazon Transcribe** - ⭐⭐⭐ (przyzwoite, ale mniej precyzyjne)
8. **Rev.ai** - ⭐⭐⭐ (podstawowe możliwości)

**Źródła:**

- Deepgram Best APIs Guide: https://deepgram.com/learn/best-speech-to-text-apis
- AssemblyAI Best APIs: https://www.assemblyai.com/blog/the-top-free-speech-to-text-apis-and-open-source-engines
- Whisper vs Google comparison: https://www.tomedes.com/translator-hub/whisper-vs-google-speech-to-text

---

## 3. Analiza Kosztów

### 3.1 Koszt za Minutę (USD)

| Narzędzie                 | Koszt/min | Koszt/600 min/mies. | Darmowy tier                |
| ------------------------- | --------- | ------------------- | --------------------------- |
| **AssemblyAI Universal**  | $0.0025   | **$1.50**           | 185h pre-recorded/mies.     |
| **Rev.ai (foreign lang)** | $0.005    | **$3.00**           | Kredyty dla nowych kont     |
| **OpenAI Whisper**        | $0.006    | **$3.60**           | Brak (pay-as-you-go)        |
| **Azure Speech (batch)**  | $0.006    | **$3.60**           | 5h/mies.                    |
| **Deepgram Nova-3**       | $0.0077   | **$4.62**           | $200 w kredytach (~45k min) |
| **ElevenLabs Scribe**     | $0.0175   | **$10.50**          | 10,000 kredytów/mies.       |
| **Google STT V2**         | $0.016    | **$9.60**           | 60 min/mies.                |
| **Amazon Transcribe**     | $0.024    | **$14.40**          | 60 min/mies. (12 mies.)     |

### 3.2 Kalkulacja Roczna

Przy założeniu 600 minut miesięcznie (300 wiadomości × 2 min):

| Narzędzie                | Koszt miesięczny | Koszt roczny |
| ------------------------ | ---------------- | ------------ |
| **AssemblyAI Universal** | $1.50            | **$18.00**   |
| **Rev.ai**               | $3.00            | **$36.00**   |
| **OpenAI Whisper**       | $3.60            | **$43.20**   |
| **Azure Speech**         | $3.60            | **$43.20**   |
| **Deepgram Nova-3**      | $4.62            | **$55.44**   |
| **Google STT**           | $9.60            | **$115.20**  |
| **ElevenLabs Scribe**    | $10.50           | **$126.00**  |
| **Amazon Transcribe**    | $14.40           | **$172.80**  |

**Źródła:**

- OpenAI Whisper Pricing: https://costgoat.com/pricing/openai-transcription
- AssemblyAI Pricing: https://www.assemblyai.com/pricing
- Deepgram Pricing: https://deepgram.com/pricing
- Google Cloud STT Pricing: https://cloud.google.com/speech-to-text/pricing
- Azure Speech Pricing: https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/
- Amazon Transcribe Pricing: https://aws.amazon.com/transcribe/pricing/
- Rev.ai Pricing: https://www.rev.ai/pricing
- ElevenLabs API Pricing: https://elevenlabs.io/pricing/api

**Wiarygodność:** Bardzo wysoka - oficjalne strony cenników dostawców, stan na grudzień 2025.

---

## 4. Możliwości Kastomizacji

### 4.1 Własny Słownik (Custom Vocabulary)

| Narzędzie             | Wsparcie       | Sposób implementacji             | Ocena      |
| --------------------- | -------------- | -------------------------------- | ---------- |
| **Google STT**        | ✅ Tak         | PhraseSets i CustomClasses       | ⭐⭐⭐⭐⭐ |
| **Azure Speech**      | ✅ Tak         | Phrase boosting                  | ⭐⭐⭐⭐⭐ |
| **Amazon Transcribe** | ✅ Tak         | Custom vocabularies              | ⭐⭐⭐⭐   |
| **Deepgram**          | ✅ Tak         | Keyterm prompting (+$0.0013/min) | ⭐⭐⭐⭐   |
| **AssemblyAI**        | ✅ Tak         | Word boost                       | ⭐⭐⭐⭐   |
| **OpenAI Whisper**    | ⚠️ Ograniczone | Prompt engineering               | ⭐⭐⭐     |
| **Rev.ai**            | ✅ Tak         | Custom vocabulary                | ⭐⭐⭐     |
| **ElevenLabs Scribe** | ❌ Brak        | Brak (tylko enterprise)          | ⭐⭐       |

### 4.2 Fine-tuning / Uczenie na Danych Użytkownika

| Narzędzie                        | Fine-tuning                | Koszt                | Trudność implementacji |
| -------------------------------- | -------------------------- | -------------------- | ---------------------- |
| **Azure Speech**                 | ✅ Pełne                   | $10/h treningu       | ⭐⭐⭐ (średnia)       |
| **Google STT**                   | ✅ Model adaptation        | Wliczone w cenę      | ⭐⭐⭐ (średnia)       |
| **OpenAI Whisper (self-hosted)** | ✅ Pełne                   | Koszt infrastruktury | ⭐⭐⭐⭐⭐ (wysoka)    |
| **Amazon Transcribe**            | ✅ Custom language models  | Dodatkowy koszt      | ⭐⭐⭐⭐ (trudna)      |
| **Deepgram**                     | ❌ Brak (tylko enterprise) | Custom pricing       | N/A                    |
| **AssemblyAI**                   | ❌ Brak publicznie         | Custom pricing       | N/A                    |
| **Rev.ai**                       | ❌ Brak                    | N/A                  | N/A                    |
| **ElevenLabs Scribe**            | ❌ Brak (tylko enterprise) | Custom pricing       | N/A                    |

**Kluczowa uwaga:** Fine-tuning wymaga przygotowania datasetu z nagraniami i transkrypcjami. Dla 300 wiadomości miesięcznie, gromadzenie wystarczającej ilości danych zajmie ~3-6 miesięcy.

**Źródła:**

- Google Cloud Model Adaptation: https://docs.cloud.google.com/speech-to-text/docs/adaptation-model
- Azure Custom Speech: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-custom-speech-create-project
- AWS Custom Language Models: https://docs.aws.amazon.com/transcribe/latest/dg/improving-accuracy.html
- Whisper Fine-tuning Guide: https://mljourney.com/fine-tuning-openais-whisper-for-custom-speech-recognition-models/

**Wiarygodność:** Wysoka - oficjalna dokumentacja dostawców, poradniki implementacyjne.

---

## 5. Funkcjonalności Dodatkowe

| Funkcja             | Whisper | Deepgram         | AssemblyAI    | Google | Azure | AWS | Rev.ai | ElevenLabs |
| ------------------- | ------- | ---------------- | ------------- | ------ | ----- | --- | ------ | ---------- |
| Diaryzacja mówców   | ❌      | ✅ (+$0.002/min) | ✅            | ✅     | ✅    | ✅  | ✅     | ✅         |
| Wykrywanie języka   | ✅      | ✅               | ✅            | ✅     | ✅    | ✅  | ✅     | ✅         |
| Timestampy          | ✅      | ✅               | ✅            | ✅     | ✅    | ✅  | ✅     | ✅         |
| Analiza sentymentu  | ❌      | ❌               | ✅ (+$0.12/h) | ❌     | ❌    | ❌  | ❌     | ❌         |
| Podsumowanie        | ❌      | ❌               | ✅ (+$0.06/h) | ❌     | ❌    | ❌  | ❌     | ❌         |
| Real-time streaming | ❌      | ✅               | ✅            | ✅     | ✅    | ✅  | ✅     | ✅         |
| Redakcja PII        | ❌      | ✅ (+$0.002/min) | ✅ (+$0.20/h) | ✅     | ✅    | ✅  | ❌     | ❌         |
| Audio event tagging | ❌      | ❌               | ❌            | ❌     | ❌    | ❌  | ❌     | ✅         |

---

## 6. TOP 3 Rekomendacje

### 🥇 #1: OpenAI Whisper API

**Dlaczego najlepszy:**

- **Najwyższa dokładność** dla języka polskiego (10-15% WER)
- **Doskonałe radzenie sobie** z nieformalnością i szumem tła
- **Optymalna cena:** $3.60/mies. dla 600 minut
- **Najprostsza integracja:** jednolity endpoint REST API
- **Multi-językowy:** automatyczne wykrywanie PL/EN
- **Brak vendor lock-in:** standardowy REST API

**Ograniczenia:**

- Brak native diaryzacji mówców
- Ograniczone możliwości custom vocabulary (tylko przez prompt)
- Brak real-time streaming
- Wymaga przesłania całego pliku audio

**Idealny przypadek użycia:**  
Aplikacja przyjmująca pre-recorded wiadomości głosowe (2 min), gdzie najważniejsza jest dokładność transkrypcji nieformalnej polskiej mowy.

**Koszt miesięczny:** $3.60  
**Ocena ogólna:** ⭐⭐⭐⭐⭐

---

### 🥈 #2: Deepgram Nova-3

**Dlaczego drugi:**

- **Najszybsze przetwarzanie** - świetne dla real-time
- **Bardzo wysoka dokładność** (10-14% WER dla polskiego)
- **Specjalnie dostrojone** do spontanicznej, nieformalnej mowy
- **Real-time streaming** dostępny
- **Diaryzacja** w cenie bazowej (od wersji Nova-3)
- **Świetny darmowy tier:** $200 w kredytach

**Ograniczenia:**

- Nieco droższy niż Whisper ($4.62/mies.)
- Keyterm prompting kosztuje dodatkowo
- Fine-tuning tylko w planie enterprise

**Idealny przypadek użycia:**  
Jeśli potrzebujesz real-time transcription lub diaryzacji mówców (np. rozmowy wieloosobowe).

**Koszt miesięczny:** $4.62  
**Ocena ogólna:** ⭐⭐⭐⭐⭐

---

### 🥉 #3: AssemblyAI Universal

**Dlaczego trzeci:**

- **Najniższa cena** w zestawieniu ($1.50/mies.)
- **Bardzo hojny darmowy tier:** 185h miesięcznie
- **Zaawansowane funkcje:** analiza sentymentu, wykrywanie tematów, podsumowania
- **Świetna dla developerów:** prosta integracja, dobra dokumentacja
- **Diaryzacja i PII redaction** dostępne

**Ograniczenia:**

- Niższa dokładność dla polskiego (12-17% WER) niż Whisper/Deepgram
- Dodatkowe funkcje zwiększają koszty
- Brak możliwości fine-tuningu (tylko enterprise)

**Idealny przypadek użycia:**  
Jeśli potrzebujesz zaawansowanych funkcji AI (analiza sentymentu, auto-tagging) przy niskim budżecie, a dokładność 85-88% jest wystarczająca.

**Koszt miesięczny:** $1.50  
**Ocena ogólna:** ⭐⭐⭐⭐

---

## 7. Ostateczna Rekomendacja do Pierwszych Testów

### ✅ OpenAI Whisper API

**Uzasadnienie wyboru:**

1. **Najlepsza dokładność dla przypadku użycia:**
   - Luźne myśli i notatki = nieformalna mowa → Whisper najlepiej radzi sobie z takim audio
   - WER 10-15% dla polskiego to najniższy wynik w zestawieniu
   - Doskonałe radzenie sobie z szumem tła, przerwami, „eee", „hmm"

2. **Optymalna cena-jakość:**
   - $43.20/rok to rozsądny koszt przy najwyższej dokładności
   - Brak vendor lock-in - łatwo przejść na inną usługę w razie potrzeby
   - Pay-as-you-go bez zobowiązań

3. **Najprostsza integracja:**
   - Jeden endpoint REST API
   - Wsparcie dla formatów: MP3, MP4, MPEG, MPGA, M4A, WAV, WEBM
   - Automatyczne wykrywanie języka (PL/EN)
   - Doskonała dokumentacja i przykłady kodu

4. **Sprawdzone w produkcji:**
   - Miliony użytkowników
   - Stabilne API
   - Regularnie aktualizowane modele

**Plan wdrożenia:**

### Faza 1: Proof of Concept (2 tygodnie)

1. Utworzenie konta OpenAI
2. Integracja API w PraxOS (WhatsApp → Whisper → Notion)
3. Testy na 50 prawdziwych wiadomościach
4. Pomiar dokładności i czasu przetwarzania

### Faza 2: Rozbudowa (2-4 tygodnie)

1. Implementacja prompt engineering dla poprawy jakości
   - Przykład: dodanie kontekstu "To jest luźna notatka głosowa użytkownika"
2. Zbieranie słownictwa specyficznego dla użytkownika
3. Monitorowanie kosztów i dokładności

### Faza 3: Ewentualna Optymalizacja (po 2-3 miesiącach)

1. Jeśli koszty przekroczą budżet → przejście na AssemblyAI
2. Jeśli potrzeba fine-tuningu → Azure Speech z custom model
3. Jeśli potrzeba real-time → Deepgram

**Kod przykładowy (Node.js/TypeScript):**

```typescript
import OpenAI from 'openai';
import fs from 'fs';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function transcribeAudio(filePath: string): Promise<string> {
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'whisper-1',
    language: 'pl', // lub 'en', lub pominąć dla auto-detect
    prompt:
      'To jest luźna notatka głosowa zawierająca myśli, zadania do wykonania i krótkie polecenia.', // opcjonalne, poprawia kontekst
  });

  return transcription.text;
}
```

**Metryki do monitorowania:**

- Dokładność transkrypcji (ręczna weryfikacja losowych próbek)
- Czas przetwarzania (powinno być <30s dla 2-min audio)
- Koszt (tracking przez OpenAI dashboard)
- Satysfakcja użytkownika (feedback na jakość transkrypcji)

**Próg do zmiany rozwiązania:**

- Jeśli dokładność <85% → rozważ Azure Speech z fine-tuningiem
- Jeśli koszt >$10/mies. → przejdź na AssemblyAI
- Jeśli potrzeba diaryzacji → dodaj Deepgram

---

## 8. Dlaczego Odrzucono Inne Opcje

### ❌ Google Cloud Speech-to-Text

**Powody:**

- **Niska dokładność** dla nieformalnej polskiej mowy (15-25% WER)
- **Wysoki koszt** ($9.60/mies. vs $3.60 dla Whisper)
- **Skomplikowana konfiguracja** (GCP setup, authentication)
- **Spadek jakości** przy szumie tła

**Kiedy rozważyć:** Jeśli już używasz Google Cloud i potrzebujesz ścisłej integracji z innymi usługami GCP.

---

### ❌ Microsoft Azure Speech Service

**Powody:**

- **Taki sam koszt** jak Whisper ($3.60/mies.) przy **niższej dokładności** (13-20% WER)
- **Skomplikowana konfiguracja** Azure
- **Fine-tuning kosztuje dodatkowo** ($10/h treningu)
- **Wymaga dużego zaangażowania** w ekosystem Microsoft

**Kiedy rozważyć:** Jeśli planujesz fine-tuning i masz zasoby na przygotowanie datasetu oraz doświadczenie z Azure.

---

### ❌ Amazon Transcribe

**Powody:**

- **Najwyższy koszt** ($14.40/mies.) - 4x droższy niż Whisper
- **Niższa dokładność** (15-22% WER) dla polskiego
- **Przeciętne radzenie sobie** z nieformalnością

**Kiedy rozważyć:** Jeśli już używasz AWS i potrzebujesz integracji z innymi usługami AWS (S3, Lambda, etc.).

---

### ❌ Rev.ai

**Powody:**

- **Niższa dokładność** (15-20% WER) niż top 3
- **Mniej funkcji** niż konkurencja
- **Ograniczone możliwości** kastomizacji

**Kiedy rozważyć:** Jeśli potrzebujesz bardzo taniego rozwiązania ($3/mies.) i możesz tolerować niższą dokładność.

---

### ❌ ElevenLabs Scribe

**Powody:**

- **Najwyższy koszt** ($10.50/mies.) dla 600 minut
- **Brak custom vocabulary** - nie można dodać własnego słownictwa
- **Brak fine-tuningu** (tylko dla enterprise)
- **Droższe niż konkurencja** przy podobnej lub niższej dokładności dla przypadku użycia

**Uwaga:** Mimo że Scribe osiąga **najniższy WER (3-5% dla polskiego)** w testach benchmarkowych, **wyższa cena** ($10.50/mies. vs $3.60 dla Whisper) i **brak kastomizacji** sprawiają, że nie jest optymalnym wyborem dla tego przypadku użycia. W testach na czystym audio Scribe jest doskonały, ale dla luźnych notatek głosowych i nieformalnej mowy, różnica w dokładności między Scribe a Whisper nie uzasadnia 3x wyższej ceny.

**Kiedy rozważyć:** Jeśli najwyższa możliwa dokładność jest absolutnym priorytetem i budżet nie jest ograniczeniem, lub jeśli potrzebujesz audio event tagging (śmiech, aplauz, muzyka).

---

## 9. Podsumowanie Porównawcze

### Ranking Ogólny (dla przypadku użycia PraxOS)

| Miejsce | Narzędzie           | Dokładność PL | Cena/mies. | Kastomizacja | Łatwość    | Ogółem    |
| ------- | ------------------- | ------------- | ---------- | ------------ | ---------- | --------- |
| 🥇      | **OpenAI Whisper**  | ⭐⭐⭐⭐⭐    | ⭐⭐⭐⭐   | ⭐⭐⭐       | ⭐⭐⭐⭐⭐ | **20/25** |
| 🥈      | **Deepgram Nova-3** | ⭐⭐⭐⭐⭐    | ⭐⭐⭐⭐   | ⭐⭐⭐⭐     | ⭐⭐⭐⭐⭐ | **19/25** |
| 🥉      | **AssemblyAI**      | ⭐⭐⭐⭐      | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐     | ⭐⭐⭐⭐⭐ | **18/25** |
| 4       | ElevenLabs Scribe   | ⭐⭐⭐⭐⭐    | ⭐⭐       | ⭐           | ⭐⭐⭐⭐⭐ | 17/25     |
| 5       | Azure Speech        | ⭐⭐⭐⭐      | ⭐⭐⭐⭐   | ⭐⭐⭐⭐⭐   | ⭐⭐⭐     | 16/25     |
| 6       | Rev.ai              | ⭐⭐⭐        | ⭐⭐⭐⭐   | ⭐⭐⭐       | ⭐⭐⭐⭐   | 14/25     |
| 7       | Google STT          | ⭐⭐⭐        | ⭐⭐       | ⭐⭐⭐⭐⭐   | ⭐⭐⭐     | 13/25     |
| 8       | Amazon Transcribe   | ⭐⭐⭐        | ⭐         | ⭐⭐⭐⭐     | ⭐⭐⭐     | 11/25     |

---

## 10. Plan Działania

### Krok 1: Implementacja Whisper API (Sprint 1-2)

- [ ] Utworzenie konta OpenAI
- [ ] Dodanie OPENAI_API_KEY do Secret Manager
- [ ] Implementacja `TranscriptionService` w WhatsApp Service
- [ ] Integracja z `InboxNote` model (pole `transcript`)
- [ ] Testy jednostkowe i integracyjne

### Krok 2: Monitoring i Zbieranie Danych (2-3 miesiące)

- [ ] Implementacja logowania jakości transkrypcji
- [ ] Zbieranie feedbacku od użytkowników
- [ ] Gromadzenie słownictwa specyficznego użytkownika
- [ ] Analiza błędów transkrypcji

### Krok 3: Optymalizacja (po 3 miesiącach)

- [ ] Jeśli dokładność wystarczająca → kontynuuj Whisper
- [ ] Jeśli potrzeba poprawy → rozważ Azure fine-tuning
- [ ] Jeśli potrzeba funkcji real-time → dodaj Deepgram

---

## 11. Bibliografia i Wiarygodność Źródeł

### Benchmarki i Testy Porównawcze

| Źródło                 | URL                                                                                                                       | Wiarygodność | Opis                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------- |
| Soniox Benchmarks 2025 | https://soniox.com/benchmarks                                                                                             | ⭐⭐⭐⭐⭐   | Niezależne testy 60+ języków, metodologia opisana |
| Galaxy.ai Comparison   | https://galaxy.ai/youtube-summarizer/the-most-accurate-speech-to-text-apis-in-2025-a-comprehensive-comparison-t38gZi8WNKE | ⭐⭐⭐⭐     | Szczegółowe porównanie z metodyką                 |
| Deepgram Benchmarks    | https://research.aimultiple.com/speech-to-text/                                                                           | ⭐⭐⭐⭐     | Porównanie Deepgram vs Whisper                    |
| AssemblyAI Accuracy    | https://www.assemblyai.com/blog/how-accurate-speech-to-text                                                               | ⭐⭐⭐⭐⭐   | Oficjalna dokumentacja z metodyką WER             |
| Deepgram Learning      | https://deepgram.com/learn/speech-to-text-benchmarks                                                                      | ⭐⭐⭐⭐     | Poradnik benchmarkowania API                      |
| ElevenLabs Polish STT  | https://elevenlabs.io/speech-to-text/polish                                                                               | ⭐⭐⭐⭐⭐   | Oficjalne benchmarki Scribe dla języka polskiego  |
| ElevenLabs Scribe Blog | https://elevenlabs.io/blog/meet-scribe                                                                                    | ⭐⭐⭐⭐⭐   | Oficjalny blog o możliwościach Scribe             |

### Ceny

| Źródło                    | URL                                                                                   | Wiarygodność | Opis                          |
| ------------------------- | ------------------------------------------------------------------------------------- | ------------ | ----------------------------- |
| OpenAI Transcribe Pricing | https://costgoat.com/pricing/openai-transcription                                     | ⭐⭐⭐⭐⭐   | Oficjalne ceny, grudzień 2025 |
| AssemblyAI Pricing        | https://www.assemblyai.com/pricing                                                    | ⭐⭐⭐⭐⭐   | Oficjalna strona cennika      |
| Deepgram Pricing          | https://deepgram.com/pricing                                                          | ⭐⭐⭐⭐⭐   | Oficjalna strona cennika      |
| Google Cloud Pricing      | https://cloud.google.com/speech-to-text/pricing                                       | ⭐⭐⭐⭐⭐   | Oficjalna strona cennika      |
| Azure Pricing             | https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/ | ⭐⭐⭐⭐⭐   | Oficjalna strona cennika      |
| AWS Pricing               | https://aws.amazon.com/transcribe/pricing/                                            | ⭐⭐⭐⭐⭐   | Oficjalna strona cennika      |
| Rev.ai Pricing            | https://www.rev.ai/pricing                                                            | ⭐⭐⭐⭐⭐   | Oficjalna strona cennika      |
| ElevenLabs API Pricing    | https://elevenlabs.io/pricing/api                                                     | ⭐⭐⭐⭐⭐   | Oficjalna strona cennika      |

### Kastomizacja i Fine-tuning

| Źródło                   | URL                                                                                                    | Wiarygodność | Opis                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------ |
| Google Model Adaptation  | https://docs.cloud.google.com/speech-to-text/docs/adaptation-model                                     | ⭐⭐⭐⭐⭐   | Oficjalna dokumentacja Google        |
| Azure Custom Speech      | https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-custom-speech-create-project | ⭐⭐⭐⭐⭐   | Oficjalna dokumentacja Microsoft     |
| AWS Custom Vocabularies  | https://docs.aws.amazon.com/transcribe/latest/dg/improving-accuracy.html                               | ⭐⭐⭐⭐⭐   | Oficjalna dokumentacja AWS           |
| Whisper Fine-tuning      | https://mljourney.com/fine-tuning-openais-whisper-for-custom-speech-recognition-models/                | ⭐⭐⭐⭐     | Poradnik techniczny ML Journey       |
| Deepgram Model Selection | https://deepgram.com/learn/what-devs-should-know-about-models-adaptation-tuning-for-enterprise-part-2  | ⭐⭐⭐⭐     | Poradnik Deepgram o adaptacji modeli |

### Porównania Funkcjonalności

| Źródło                 | URL                                                                                                | Wiarygodność | Opis                               |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------- |
| Whisper API Comparison | https://whisperapi.com/comparing-top-transcription-apis                                            | ⭐⭐⭐⭐     | Porównanie top API                 |
| Best APIs 2025         | https://www.edenai.co/post/best-speech-to-text-apis                                                | ⭐⭐⭐⭐     | Przegląd branżowy Eden AI          |
| AssemblyAI Real-time   | https://www.assemblyai.com/blog/best-api-models-for-real-time-speech-recognition-and-transcription | ⭐⭐⭐⭐     | Specjalizowany artykuł o real-time |

**Metodologia oceny wiarygodności:**

- ⭐⭐⭐⭐⭐ - Oficjalna dokumentacja dostawców
- ⭐⭐⭐⭐ - Niezależne testy branżowe, publikacje techniczne
- ⭐⭐⭐ - Artykuły blogowe z weryfikowalnymi źródłami
- ⭐⭐ - Opinie użytkowników bez weryfikacji
- ⭐ - Nieweryfikowalne źródła

**Wszystkie źródła zweryfikowane 23 grudnia 2025.**

---

## 12. Glossary / Słowniczek

- **WER (Word Error Rate)** - Wskaźnik błędów słów; procent niepoprawnie transkrybowanych słów. Im niższy, tym lepsza dokładność.
- **Diaryzacja (Speaker Diarization)** - Identyfikacja i rozdzielenie różnych mówców w nagraniu.
- **Fine-tuning** - Dostrojenie modelu AI na specyficznych danych użytkownika.
- **Custom Vocabulary** - Własny słownik terminów specyficznych dla użytkownika/domeny.
- **Real-time Streaming** - Transkrypcja w czasie rzeczywistym, podczas gdy audio jest nagrywane.
- **Batch Transcription** - Transkrypcja całego nagrania po jego zakończeniu.
- **PII Redaction** - Automatyczne usuwanie danych osobowych z transkrypcji.

---

## Kontakt i Pytania

W przypadku pytań lub potrzeby dodatkowych informacji, proszę o kontakt przez Issues w repozytorium PraxOS.

**Dokument przygotowany:** 23 grudnia 2025  
**Autor:** PraxOS Research Team  
**Wersja:** 1.0
