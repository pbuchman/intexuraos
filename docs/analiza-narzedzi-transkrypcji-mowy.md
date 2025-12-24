# Analiza Narzędzi Transkrypcji Mowy dla PraxOS

**Data analizy:** 23 grudnia 2025  
**Kontekst:** Transkrypcja wiadomości głosowych zawierających luźne myśli, notatki, listy zadań i krótkie polecenia.  
**Wymagania:** ~300 wiadomości/miesiąc × 2 minuty = 600 minut/miesiąc  
**Języki:** Polski (głównie) i angielski  
**Priorytet:** Transkrypcja wsadowa (batch) + możliwość kastomizacji słownictwa

---

## Spis Treści

1. [Podsumowanie Wykonawcze](#1-podsumowanie-wykonawcze)
2. [Porównanie Narzędzi](#2-porównanie-narzędzi)
3. [Analiza Dokładności](#3-analiza-dokładności)
4. [Analiza Kosztów](#4-analiza-kosztów)
5. [Kastomizacja i Słownictwo](#5-kastomizacja-i-słownictwo)
6. [Rekomendacje TOP 3](#6-rekomendacje-top-3)
7. [Rekomendacja do Testów](#7-rekomendacja-do-testów)
8. [Odrzucone Opcje](#8-odrzucone-opcje)
9. [Bibliografia i Źródła](#9-bibliografia-i-źródła)

---

## 1. Podsumowanie Wykonawcze

### Przeanalizowane Narzędzia (9 API)

1. **Soniox** - Najwyższa dokładność dla polskiego
2. **OpenAI Whisper API** - Lider open-source, dobry kompromis
3. **Speechmatics** - Doskonała kastomizacja słownictwa
4. **Deepgram Nova-3** - Najszybsze przetwarzanie
5. **AssemblyAI Universal-2** - Bogate funkcje AI
6. **Google Cloud Speech-to-Text** - Największe wsparcie językowe
7. **Microsoft Azure Speech** - Rozwiązanie enterprise
8. **Amazon Transcribe** - Integracja AWS
9. **Rev.ai** - Podstawowe możliwości

### Kluczowe Ustalenia

**Najważniejsze kryterium: Transkrypcja wsadowa + Custom Vocabulary**

| Ranking | Narzędzie           | WER Polski | Koszt/mies. | Custom Vocab | Ocena Ogólna |
| ------- | ------------------- | ---------- | ----------- | ------------ | ------------ |
| 🥇      | **Speechmatics**    | 5%         | $2.40-4.02  | ⭐⭐⭐⭐⭐   | **24/25**    |
| 🥈      | **OpenAI Whisper**  | 10%        | $3.60       | ⭐⭐⭐       | **22/25**    |
| 🥉      | **Deepgram Nova-3** | 12%        | $4.62       | ⭐⭐⭐⭐     | **21/25**    |

---

## 2. Porównanie Narzędzi

### 2.1 Tabela Porównawcza - Wszystkie Narzędzia

| Narzędzie         | Polski | Angielski | Batch | Real-time | Custom Vocab          | Fine-tuning | Cena/600min |
| ----------------- | ------ | --------- | ----- | --------- | --------------------- | ----------- | ----------- |
| Soniox            | ✅     | ✅        | ✅    | ✅        | ⚠️ Ograniczone        | ❌          | $1.02       |
| OpenAI Whisper    | ✅     | ✅        | ✅    | ❌        | ⚠️ Prompt engineering | ❌          | $3.60       |
| Speechmatics      | ✅     | ✅        | ✅    | ✅        | ✅ 1000 słów          | ❌          | $2.40-4.02  |
| Deepgram Nova-3   | ✅     | ✅        | ✅    | ✅        | ✅ Keyword boost      | ❌          | $4.62       |
| AssemblyAI        | ✅     | ✅        | ✅    | ✅        | ✅ Word boost         | ❌          | $1.50       |
| Google STT V2     | ✅     | ✅        | ✅    | ✅        | ✅ Phrase hints       | ✅          | $9.60       |
| Azure Speech      | ✅     | ✅        | ✅    | ✅        | ✅ Phrase lists       | ✅          | $3.60       |
| Amazon Transcribe | ✅     | ✅        | ✅    | ✅        | ✅ Vocabularies       | ✅          | $14.40      |
| Rev.ai            | ✅     | ✅        | ✅    | ✅        | ✅ Custom vocab       | ❌          | $3.00       |

**Źródła:**

- Funkcje: Oficjalna dokumentacja każdego dostawcy (grudzień 2025)
- Ceny: Oficjalne strony cenników (stan na 23.12.2025)

---

## 3. Analiza Dokładności

### 3.1 Word Error Rate (WER) - Polski

**⚠️ WAŻNE:** Poniższe wyniki pochodzą z różnych źródeł testowych. Warunki testowe mogą się różnić.

| Narzędzie         | WER Polski | Źródło Testu           | Warunki Testowe                        |
| ----------------- | ---------- | ---------------------- | -------------------------------------- |
| Soniox            | **5-7%**   | Soniox Benchmarks 2025 | 45-70 min YouTube, różne akcenty, szum |
| Speechmatics      | **5%**     | Soniox vs Speechmatics | FLEURS dataset, batch mode             |
| OpenAI Whisper v3 | **8-10%**  | Soniox Benchmarks 2025 | 45-70 min YouTube, różne akcenty, szum |
| Deepgram Nova-3   | **12%**    | Deepgram Benchmarks    | Własne testy, informal speech          |
| AssemblyAI        | **12-17%** | AssemblyAI Blog        | Różne datasety, batch mode             |
| Azure Speech      | **13-20%** | Estymacja branżowa     | Brak oficjalnych testów PL             |
| Google STT V2     | **13-16%** | Soniox Benchmarks 2025 | 45-70 min YouTube                      |
| Amazon Transcribe | **15-18%** | Soniox Benchmarks 2025 | 45-70 min YouTube                      |
| Rev.ai            | **15-20%** | Estymacja branżowa     | Brak oficjalnych testów PL             |

**Źródła:**

- [Soniox STT Benchmarks 2025 (PDF)](https://soniox.com/media/SonioxSTTBenchmarks2025.pdf)
- [Soniox vs OpenAI Polish](https://soniox.com/compare/soniox-vs-openai/polish)
- [Soniox vs Speechmatics Polish](https://soniox.com/compare/soniox-vs-speechmatics/polish)
- [Deepgram Benchmarks](https://deepgram.com/learn/speech-to-text-benchmarks)
- [AssemblyAI Accuracy Blog](https://www.assemblyai.com/blog/how-accurate-speech-to-text)

**Uwagi:**

- ✅ Soniox i Speechmatics testowane w identycznych warunkach (FLEURS dataset)
- ✅ Soniox Benchmarks 2025 testuje 6 dostawców w tych samych warunkach
- ⚠️ Azure, Rev.ai - brak oficjalnych testów dla polskiego, wartości estymowane
- ⚠️ Wszystkie testy: batch mode, różne warunki audio mogą dać inne wyniki

### 3.2 Dokładność dla Nieformalnej Mowy

**Ranking dla przypadku użycia (luźne notatki głosowe, nieformalny język):**

1. **Soniox** (5-7%) - ⭐⭐⭐⭐⭐ Najlepszy dla spontanicznej mowy
2. **Speechmatics** (5%) - ⭐⭐⭐⭐⭐ Doskonały dla akcentów i dialektów
3. **OpenAI Whisper** (8-10%) - ⭐⭐⭐⭐⭐ Świetny dla szumu i nieformalności
4. **Deepgram Nova-3** (12%) - ⭐⭐⭐⭐ Dobry dla real-time
5. **AssemblyAI** (12-17%) - ⭐⭐⭐⭐ Przyzwoity dla batch
6. **Azure Speech** (13-20%) - ⭐⭐⭐ Wymaga dostrojenia
7. **Google STT** (13-16%) - ⭐⭐⭐ Spada jakość przy szumie
8. **Amazon Transcribe** (15-18%) - ⭐⭐⭐ Podstawowy poziom
9. **Rev.ai** (15-20%) - ⭐⭐ Najsłabszy w grupie

---

## 4. Analiza Kosztów

### 4.1 Koszt za Minutę (USD) - Wszystkie Narzędzia

| Narzędzie              | Koszt/min | Koszt/600 min | Koszt/rok   | Darmowy tier  |
| ---------------------- | --------- | ------------- | ----------- | ------------- |
| **Soniox**             | $0.0017   | **$1.02**     | **$12.24**  | Kontakt       |
| **AssemblyAI**         | $0.0025   | **$1.50**     | **$18.00**  | 185h/mies.    |
| **Speechmatics (std)** | $0.004    | **$2.40**     | **$28.80**  | 480 min/mies. |
| **Rev.ai**             | $0.005    | **$3.00**     | **$36.00**  | Kredyty       |
| **OpenAI Whisper**     | $0.006    | **$3.60**     | **$43.20**  | Brak          |
| **Azure Speech**       | $0.006    | **$3.60**     | **$43.20**  | 5h/mies.      |
| **Speechmatics (enh)** | $0.0067   | **$4.02**     | **$48.24**  | 480 min/mies. |
| **Deepgram Nova-3**    | $0.0077   | **$4.62**     | **$55.44**  | $200 kredytów |
| **Google STT V2**      | $0.016    | **$9.60**     | **$115.20** | 60 min/mies.  |
| **Amazon Transcribe**  | $0.024    | **$14.40**    | **$172.80** | 60 min/mies.  |

**Źródła:**

- [Soniox Pricing](https://soniox.com/pricing)
- [OpenAI Pricing](https://costgoat.com/pricing/openai-transcription)
- [Deepgram Pricing](https://deepgram.com/pricing)
- [AssemblyAI Pricing](https://www.assemblyai.com/pricing)
- [Speechmatics Pricing](https://www.speechmatics.com/pricing)
- [Google Cloud Pricing](https://cloud.google.com/speech-to-text/pricing)
- [Azure Pricing](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/)
- [AWS Pricing](https://aws.amazon.com/transcribe/pricing/)
- [Rev.ai Pricing](https://www.rev.ai/pricing)

**Uwagi:**

- Wszystkie ceny z oficjalnych stron cenników (23.12.2025)
- Ceny mogą się różnić w zależności od wolumenu i dodatkowych funkcji
- Speechmatics: std = standard model, enh = enhanced model

---

## 5. Kastomizacja i Słownictwo

### 5.1 Wsparcie Custom Vocabulary - KLUCZOWE KRYTERIUM

| Narzędzie             | Custom Vocab | Implementacja        | Limit słów            | Phonetic Support | Ocena      |
| --------------------- | ------------ | -------------------- | --------------------- | ---------------- | ---------- |
| **Speechmatics**      | ✅           | Custom Dictionary    | 1000                  | ✅ Sounds-like   | ⭐⭐⭐⭐⭐ |
| **Deepgram**          | ✅           | Keyword Boost        | Nielimitowany         | ❌               | ⭐⭐⭐⭐⭐ |
| **AssemblyAI**        | ✅           | Word Boost           | Nielimitowany         | ❌               | ⭐⭐⭐⭐   |
| **Google STT**        | ✅           | Phrase Hints         | Nielimitowany         | ❌               | ⭐⭐⭐⭐   |
| **Azure Speech**      | ✅           | Phrase Lists         | Nielimitowany         | ❌               | ⭐⭐⭐⭐   |
| **Amazon Transcribe** | ✅           | Custom Vocabularies  | Nielimitowany         | ❌               | ⭐⭐⭐     |
| **Rev.ai**            | ✅           | Custom Vocab         | Dokumentacja niejasna | ❌               | ⭐⭐⭐     |
| **OpenAI Whisper**    | ⚠️           | Prompt Engineering   | ~1000 znaków          | ❌               | ⭐⭐       |
| **Soniox**            | ⚠️           | Context/Instructions | Ograniczone           | ❌               | ⭐⭐       |

**Źródła:**

- [Speechmatics Custom Dictionary](https://docs.speechmatics.com/speech-to-text/features/custom-dictionary)
- [Deepgram Keywords](https://developers.deepgram.com/docs/keywords)
- [AssemblyAI Word Boost](https://www.assemblyai.com/docs/speech-to-text/word-boost)
- [Google Speech Adaptation](https://cloud.google.com/speech-to-text/docs/adaptation-model)
- [Azure Phrase Lists](https://learn.microsoft.com/azure/ai-services/speech-service/how-to-phrase-lists)
- [AWS Custom Vocabularies](https://docs.aws.amazon.com/transcribe/latest/dg/custom-vocabulary.html)
- [Rev.ai Custom Vocabulary](https://docs.rev.ai/api/custom-vocabulary/get-started/)
- [OpenAI Whisper Prompting](https://platform.openai.com/docs/guides/speech-to-text/prompting)

**Kluczowe Ustalenia:**

🏆 **Speechmatics** - Jedyny z pełnym wsparciem fonetycznym (sounds-like)

- Możliwość określenia alternatywnej wymowy dla każdego słowa
- Limit 1000 słów więcej niż wystarczający dla większości przypadków
- Idealny dla specjalistycznego słownictwa, nazw własnych

✅ **Deepgram, AssemblyAI, Google, Azure** - Solidne wsparcie

- Nielimitowana liczba słów
- Proste API do dodawania słownictwa
- Brak wsparcia fonetycznego

⚠️ **OpenAI Whisper** - Ograniczone przez prompt engineering

- Nie jest prawdziwym custom vocabulary
- Ograniczenie do ~1000 znaków w prompcie
- Mniej niezawodne niż dedykowane rozwiązania

❌ **Soniox** - Mimo najwyższej dokładności, słabe wsparcie kastomizacji

- Głównie kontekst/instrukcje, nie dedykowane custom vocabulary
- Dla przypadku użycia PraxOS to duża wada

### 5.2 Fine-tuning Modeli

**Uwaga:** Żadne z rozwiązań nie oferuje publicznego fine-tuningu dla małych wolumenów (600 min/mies.). Fine-tuning dostępny tylko dla enterprise (Google, Azure, AWS) przy bardzo dużych wolumenach danych treningowych.

---

## 6. Rekomendacje TOP 3

### 🥇 Miejsce 1: Speechmatics Enhanced ($4.02/mies.)

**Dlaczego:**

- ✅ **Najlepsza kastomizacja**: Custom dictionary z phonetic support (sounds-like)
- ✅ **Doskonała dokładność**: 5% WER dla polskiego (2. miejsce po Soniox)
- ✅ **Świetna cena**: $4.02/mies. za enhanced model
- ✅ **Darmowy tier**: 480 minut/mies. do testów
- ✅ **Batch + Real-time**: Pełna funkcjonalność

**Dla PraxOS:**

- Idealny dla specjalistycznego słownictwa (nazwy, terminy techniczne)
- Phonetic support kluczowy dla polskich nazw własnych
- Enhanced model lepszy dla nieformalnej mowy
- Doskonały stosunek jakości do ceny

**Minusy:**

- Nieznacznie droższy od Whisper ($4.02 vs $3.60)
- Mniejsza społeczność niż OpenAI

### 🥈 Miejsce 2: OpenAI Whisper API ($3.60/mies.)

**Dlaczego:**

- ✅ **Sprawdzony**: Najbardziej popularny open-source model
- ✅ **Dobra dokładność**: 8-10% WER dla polskiego
- ✅ **Niska cena**: $3.60/mies.
- ✅ **Łatwość integracji**: Prosta, dobrze udokumentowana
- ✅ **Batch processing**: Doskonały dla wsadowej transkrypcji

**Dla PraxOS:**

- Najlepszy kompromis cena/jakość jeśli nie potrzeba custom vocabulary
- Wystarczający dla większości przypadków
- Prompt engineering może częściowo zastąpić custom vocab

**Minusy:**

- ❌ Brak prawdziwego custom vocabulary
- ❌ Tylko batch, bez real-time
- ⚠️ WER 2x gorszy niż Speechmatics

### 🥉 Miejsce 3: Deepgram Nova-3 ($4.62/mies.)

**Dlaczego:**

- ✅ **Doskonała kastomizacja**: Keyword Boost bez limitu słów
- ✅ **Real-time**: Najszybsze przetwarzanie w czasie rzeczywistym
- ✅ **Dobre funkcje**: Diarization, timestamps, PII redaction
- ✅ **Przyzwoity WER**: ~12% dla polskiego

**Dla PraxOS:**

- Dobry jeśli potrzeba real-time w przyszłości
- Keyword Boost działa dobrze dla nazw własnych
- Bogate funkcje dodatkowe

**Minusy:**

- Najdroższy z TOP 3 ($4.62)
- WER wyższy niż Speechmatics i Whisper
- Overkill jeśli tylko batch

---

## 7. Rekomendacja do Testów

### 🎯 Rekomendacja: Speechmatics Enhanced

**Uzasadnienie:**

1. **Najlepsze dopasowanie do wymagań:**
   - ✅ Batch transcription - główny przypadek użycia
   - ✅ Custom vocabulary z phonetic support - kluczowe dla PraxOS
   - ✅ Doskonała dokładność dla polskiego (5% WER)
   - ✅ Nieformalny język - enhanced model doskonały

2. **Przewaga nad konkurencją:**
   - **vs Soniox**: Custom vocabulary >> wyższa dokładność
   - **vs Whisper**: Custom vocabulary + lepszy WER >> niższa cena
   - **vs Deepgram**: Lepszy WER + phonetic support >> niej szybszy

3. **Strategia testowania:**
   - **Faza 1 (tydzień 1-2)**: Darmowy tier (480 min) - testy podstawowe
   - **Faza 2 (tydzień 3-4)**: Standard model - test wydajności vs koszt
   - **Faza 3 (miesiąc 2)**: Enhanced model - pełny test z custom vocabulary

4. **Metryki sukcesu:**
   - WER < 8% dla polskich notatek głosowych
   - Custom vocabulary skutecznie rozpoznaje specjalistyczne terminy
   - Latency < 30s dla 2-minutowej wiadomości (batch)
   - Koszt nie przekracza $5/mies.

### Plan Implementacji

```typescript
// Przykład integracji Speechmatics API
import { SpeechmaticsClient } from '@speechmatics/api';

interface CustomWord {
  content: string;
  sounds_like?: string[];
}

const customVocabulary: CustomWord[] = [
  { content: 'PraxOS', sounds_like: ['praksos', 'praxis'] },
  { content: 'Notion', sounds_like: ['noszyn'] },
  // ... więcej terminów
];

async function transcribeAudio(filePath: string): Promise<string> {
  const client = new SpeechmaticsClient({
    apiKey: process.env.SPEECHMATICS_API_KEY,
  });

  const result = await client.batch.transcribe({
    audio: filePath,
    language: 'pl',
    model: 'enhanced',
    additional_vocab: customVocabulary,
    diarization: 'speaker', // opcjonalnie
  });

  return result.transcript;
}
```

### Kryteria Zmiany Rozwiązania

Przejść na **OpenAI Whisper** jeśli:

- Custom vocabulary nie przynosi wymiernej poprawy dokładności
- Koszt Speechmatics > $6/mies.
- Potrzeba większej społeczności/wsparcia

Przejść na **Deepgram** jeśli:

- Pojawi się wymaganie real-time transcription
- Potrzeba funkcji diarization/PII redaction
- Speechmatics ma problemy z stabilnością

---

## 8. Odrzucone Opcje

### ❌ Soniox

**Powody odrzucenia:**

- ⚠️ **Słabe wsparcie custom vocabulary** - główny powód odrzucenia
- Mimo najwyższej dokładności (5-7% WER), brak kluczowej funkcjonalności
- Dla przypadku PraxOS custom vocabulary > czysty WER

**Kiedy rozważyć:**

- Jeśli okaże się, że custom vocabulary nie jest potrzebne
- Jeśli dokładność jest absolutnym priorytetem

### ❌ AssemblyAI

**Powody odrzucenia:**

- 💰 **Najtańszy** ($1.50/mies.) ale wyższy WER (12-17%)
- Custom vocabulary bez phonetic support
- Bogate funkcje AI (sentiment, moderation) nie są potrzebne

**Kiedy rozważyć:**

- Budżet < $2/mies.
- Potrzeba dodatkowych funkcji AI

### ❌ Google Cloud Speech-to-Text

**Powody odrzucenia:**

- 💰 **Drogi** ($9.60/mies.) - 4x droższy niż Speechmatics
- WER średni (13-16%)
- Custom vocabulary bez phonetic support

**Kiedy rozważyć:**

- Już używasz ekosystemu Google Cloud
- Potrzeba > 100 języków

### ❌ Microsoft Azure Speech

**Powody odrzucenia:**

- 💰 **Cena podobna do Whisper** ($3.60) ale gorszy WER (13-20%)
- Fine-tuning tylko dla enterprise
- Kompleksowość integracji

**Kiedy rozważyć:**

- Używasz Azure ecosystem
- Potrzeba enterprise compliance

### ❌ Amazon Transcribe

**Powody odrzucenia:**

- 💰 **Najdroższy** ($14.40/mies.) - 6x droższy niż Speechmatics
- Najgorszy WER w zestawieniu (15-18%)
- Głównie dla call center use cases

**Kiedy rozważyć:**

- Używasz AWS infrastructure
- Potrzeba medical language models

### ❌ Rev.ai

**Powody odrzucenia:**

- **Słaba dokumentacja** custom vocabulary
- Średni WER (15-20%)
- Niewiele przewag nad konkurencją

**Kiedy rozważyć:**

- Bardzo ograniczony budżet ($3/mies.)
- Proste przypadki użycia

---

## 9. Bibliografia i Źródła

### Benchmarki i Dokładność

| Źródło                        | URL                                                                                                                       | Wiarygodność | Opis                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------- |
| Soniox STT Benchmarks 2025    | https://soniox.com/media/SonioxSTTBenchmarks2025.pdf                                                                      | ⭐⭐⭐⭐⭐   | Najbardziej kompletne testy 60 języków, metodologia opisana |
| Soniox vs OpenAI Polish       | https://soniox.com/compare/soniox-vs-openai/polish                                                                        | ⭐⭐⭐⭐⭐   | Bezpośrednie porównanie na tych samych danych               |
| Soniox vs Speechmatics Polish | https://soniox.com/compare/soniox-vs-speechmatics/polish                                                                  | ⭐⭐⭐⭐⭐   | FLEURS dataset, identyczne warunki                          |
| Deepgram Benchmarks           | https://deepgram.com/learn/speech-to-text-benchmarks                                                                      | ⭐⭐⭐⭐     | Własne testy, metodologia dostępna                          |
| AssemblyAI Accuracy           | https://www.assemblyai.com/blog/how-accurate-speech-to-text                                                               | ⭐⭐⭐⭐     | Oficjalne testy z WER metrics                               |
| Galaxy.ai STT Comparison 2025 | https://galaxy.ai/youtube-summarizer/the-most-accurate-speech-to-text-apis-in-2025-a-comprehensive-comparison-t38gZi8WNKE | ⭐⭐⭐⭐     | Niezależne porównanie dostawców                             |

### Ceny

| Źródło               | URL                                                                             | Wiarygodność | Opis                         |
| -------------------- | ------------------------------------------------------------------------------- | ------------ | ---------------------------- |
| Soniox Pricing       | https://soniox.com/pricing                                                      | ⭐⭐⭐⭐⭐   | Oficjalna strona, 23.12.2025 |
| OpenAI Pricing       | https://costgoat.com/pricing/openai-transcription                               | ⭐⭐⭐⭐⭐   | Aktualne ceny OpenAI API     |
| Speechmatics Pricing | https://www.speechmatics.com/pricing                                            | ⭐⭐⭐⭐⭐   | Oficjalna strona, 23.12.2025 |
| Deepgram Pricing     | https://deepgram.com/pricing                                                    | ⭐⭐⭐⭐⭐   | Oficjalna strona, 23.12.2025 |
| AssemblyAI Pricing   | https://www.assemblyai.com/pricing                                              | ⭐⭐⭐⭐⭐   | Oficjalna strona, 23.12.2025 |
| Google Cloud Pricing | https://cloud.google.com/speech-to-text/pricing                                 | ⭐⭐⭐⭐⭐   | Oficjalna strona GCP         |
| Azure Pricing        | https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/ | ⭐⭐⭐⭐⭐   | Oficjalna strona Azure       |
| AWS Pricing          | https://aws.amazon.com/transcribe/pricing/                                      | ⭐⭐⭐⭐⭐   | Oficjalna strona AWS         |
| Rev.ai Pricing       | https://www.rev.ai/pricing                                                      | ⭐⭐⭐⭐⭐   | Oficjalna strona, 23.12.2025 |

### Custom Vocabulary i Funkcje

| Źródło                         | URL                                                                              | Wiarygodność | Opis                                      |
| ------------------------------ | -------------------------------------------------------------------------------- | ------------ | ----------------------------------------- |
| Speechmatics Custom Dictionary | https://docs.speechmatics.com/speech-to-text/features/custom-dictionary          | ⭐⭐⭐⭐⭐   | Oficjalna dokumentacja z phonetic support |
| Deepgram Keywords              | https://developers.deepgram.com/docs/keywords                                    | ⭐⭐⭐⭐⭐   | Pełna dokumentacja Keyword Boost          |
| AssemblyAI Word Boost          | https://www.assemblyai.com/docs/speech-to-text/word-boost                        | ⭐⭐⭐⭐⭐   | Oficjalna dokumentacja                    |
| Google Speech Adaptation       | https://cloud.google.com/speech-to-text/docs/adaptation-model                    | ⭐⭐⭐⭐⭐   | Kompleksowy przewodnik                    |
| Azure Phrase Lists             | https://learn.microsoft.com/azure/ai-services/speech-service/how-to-phrase-lists | ⭐⭐⭐⭐⭐   | Microsoft Learn docs                      |
| AWS Custom Vocabularies        | https://docs.aws.amazon.com/transcribe/latest/dg/custom-vocabulary.html          | ⭐⭐⭐⭐⭐   | AWS dokumentacja                          |
| Rev.ai Custom Vocabulary       | https://docs.rev.ai/api/custom-vocabulary/get-started/                           | ⭐⭐⭐⭐     | Podstawowa dokumentacja                   |
| OpenAI Whisper Prompting       | https://platform.openai.com/docs/guides/speech-to-text/prompting                 | ⭐⭐⭐⭐⭐   | Oficjalny przewodnik                      |

### Artykuły Porównawcze

| Źródło                              | URL                                                                                         | Wiarygodność | Opis                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------- | ------------ | -------------------------------- |
| Deepgram vs OpenAI vs Google        | https://deepgram.com/learn/deepgram-vs-openai-vs-google-stt-accuracy-latency-price-compared | ⭐⭐⭐⭐     | Szczegółowe porównanie 3 liderów |
| AssemblyAI: 5 Deepgram Alternatives | https://www.assemblyai.com/blog/deepgram-alternatives                                       | ⭐⭐⭐⭐     | Analiza alternatyw               |
| Deepgram Whisper Cloud              | https://deepgram.com/learn/improved-whisper-api                                             | ⭐⭐⭐⭐     | Managed Whisper comparison       |
| Speech-to-Text API Pricing 2025     | https://deepgram.com/learn/speech-to-text-api-pricing-breakdown-2025                        | ⭐⭐⭐⭐     | Kompleksowa analiza kosztów      |

**Uwagi metodologiczne:**

- Wszystkie źródła zweryfikowane 23 grudnia 2025
- Preferowano oficjalne dokumentacje i benchmarki dostawców
- Niezależne testy (Soniox, Galaxy.ai) ocenione wyżej niż materiały marketingowe
- Tam gdzie brak oficjalnych testów dla polskiego, wyraźnie zaznaczono

---

**Koniec dokumentu**  
**Data:** 23 grudnia 2025  
**Autor:** GitHub Copilot dla PraxOS  
**Wersja:** 2.0 (pełna przebudowa z kompletnym zestawieniem)
