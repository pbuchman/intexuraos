/**
 * Linear issue extraction prompt for parsing natural language into structured issue data.
 * Used by linear-agent to extract issue details from user messages.
 */

import type { PromptBuilder, PromptDeps } from '../types.js';

export interface LinearIssueExtractionPromptInput {
  /** The user message to extract issue from */
  text: string;
}

export interface LinearIssueExtractionPromptDeps extends PromptDeps {
  /** Maximum description length (default: 2000) */
  maxDescriptionLength?: number;
}

/**
 * Extracted Linear issue data.
 */
export interface ExtractedLinearIssue {
  /** Issue title (required) */
  title: string;
  /** Priority: 0=none, 1=urgent, 2=high, 3=normal, 4=low */
  priority: 0 | 1 | 2 | 3 | 4;
  /** Functional requirements extracted from message */
  functionalRequirements: string | null;
  /** Technical details extracted from message */
  technicalDetails: string | null;
  /** Whether extraction was successful */
  valid: boolean;
  /** Error message if extraction failed */
  error: string | null;
  /** Reasoning for extraction decisions */
  reasoning: string;
}

export const linearActionExtractionPrompt: PromptBuilder<
  LinearIssueExtractionPromptInput,
  LinearIssueExtractionPromptDeps
> = {
  name: 'linear-action-extraction',
  description: 'Extracts structured Linear issue data from natural language text',

  build(input: LinearIssueExtractionPromptInput, deps?: LinearIssueExtractionPromptDeps): string {
    const maxLength = deps?.maxDescriptionLength ?? 2000;
    const textPreview = input.text.length > maxLength ? input.text.slice(0, maxLength) : input.text;

    const truncationWarning =
      input.text.length > maxLength
        ? `\n\n⚠️ IMPORTANT: Text was truncated to first ${String(maxLength)} characters.\n`
        : '';

    return `Extract Linear issue information from the user's message.

TASK: Parse the message and create a structured issue with title, priority, and organized description.

RULES:
1. LANGUAGE: Maintain the SAME LANGUAGE as the user's message
   - English message → English title/description
   - Polish message → Polish title/description

2. TITLE EXTRACTION:
   - Create a clear, concise title (max 100 characters)
   - Focus on the main task or feature
   - Remove filler words like "please", "I want to"

3. PRIORITY DETECTION:
   - 0 = No priority (default if not mentioned)
   - 1 = Urgent (keywords: urgent, asap, critical, immediately, pilne, natychmiast)
   - 2 = High (keywords: high priority, important, ważne, priorytet)
   - 3 = Normal (default for most tasks)
   - 4 = Low (keywords: when you have time, low priority, niska priorytet)

4. DESCRIPTION EXTRACTION:
   Split the content into two sections when applicable:

   ## Functional Requirements
   - What the feature/fix should DO from user perspective
   - User-visible behavior changes
   - Acceptance criteria if mentioned

   ## Technical Details
   - Implementation hints or constraints
   - Technical context mentioned
   - Files, APIs, or systems referenced

   If no clear technical details, leave technicalDetails as null.
   If no clear functional requirements beyond the title, leave functionalRequirements as null.

5. VALIDATION:
   - valid = true if at least a title can be extracted
   - valid = false only if message is completely unclear/empty

EXAMPLES (ENGLISH):

Input: "Add dark mode toggle to settings page, should persist in local storage"
Output:
{
  "title": "Add dark mode toggle to settings",
  "priority": 0,
  "functionalRequirements": "- Add toggle switch for dark/light mode in settings page\\n- User preference should persist across sessions",
  "technicalDetails": "- Store preference in local storage",
  "valid": true,
  "error": null,
  "reasoning": "Clear feature request with user-visible behavior and technical implementation detail"
}

Input: "URGENT: Fix login button not working on mobile"
Output:
{
  "title": "Fix login button not working on mobile",
  "priority": 1,
  "functionalRequirements": "- Login button should be clickable and functional on mobile devices\\n- Should trigger same login flow as desktop",
  "technicalDetails": null,
  "valid": true,
  "error": null,
  "reasoning": "Bug report marked as urgent, extracted functional requirement from issue description"
}

Input: "Research best practices for API rate limiting"
Output:
{
  "title": "Research API rate limiting best practices",
  "priority": 0,
  "functionalRequirements": null,
  "technicalDetails": "- Research task, no implementation yet\\n- Focus on API rate limiting strategies",
  "valid": true,
  "error": null,
  "reasoning": "Research task with technical focus, no functional requirements as it's not a feature"
}

EXAMPLES (POLISH):

Input: "Dodaj możliwość eksportu danych do CSV, ważne dla raportu w piątek"
Output:
{
  "title": "Dodaj eksport danych do CSV",
  "priority": 2,
  "functionalRequirements": "- Użytkownik może eksportować dane do pliku CSV\\n- Dostępne z poziomu interfejsu raportowania",
  "technicalDetails": null,
  "valid": true,
  "error": null,
  "reasoning": "Funkcjonalność oznaczona jako ważna (priorytet wysoki), jasne wymaganie funkcjonalne"
}

Input: "Napraw błąd w walidacji formularza rejestracji, sprawdź regex dla numeru telefonu"
Output:
{
  "title": "Napraw walidację numeru telefonu w rejestracji",
  "priority": 0,
  "functionalRequirements": "- Numer telefonu powinien być poprawnie walidowany w formularzu rejestracji",
  "technicalDetails": "- Sprawdzić i poprawić wyrażenie regularne (regex) dla walidacji numeru telefonu",
  "valid": true,
  "error": null,
  "reasoning": "Zgłoszenie błędu z kontekstem technicznym (regex)"
}

${truncationWarning}
USER MESSAGE TO PROCESS:
${textPreview}

Respond with ONLY a JSON object in the format shown above. Do not include any additional text.`;
  },
};
