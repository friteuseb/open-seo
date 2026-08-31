/**
 * Weighted keyword extraction for internal-linking similarity.
 *
 * Produces a small, bounded set of significant terms per page (not the raw
 * body text) so similarity can be computed later without persisting a large
 * text blob per page. Title/H1/meta description are repeated in proportion
 * to their weight before tokenizing, the same trick a plain TF-IDF corpus
 * uses to bias term frequency toward the fields that best describe a page.
 */

const STOPWORDS = new Set([
  // English
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "in",
  "on",
  "at",
  "to",
  "for",
  "with",
  "by",
  "about",
  "against",
  "between",
  "into",
  "through",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "as",
  "of",
  "from",
  "your",
  "you",
  "our",
  "we",
  // French
  "le",
  "la",
  "les",
  "un",
  "une",
  "des",
  "et",
  "ou",
  "mais",
  "est",
  "sont",
  "etait",
  "etre",
  "ont",
  "dans",
  "sur",
  "pour",
  "avec",
  "par",
  "que",
  "qui",
  "donc",
  "alors",
  "si",
  "quand",
  "ces",
  "tous",
  "toutes",
  "leur",
  "leurs",
  "votre",
  "vos",
  "notre",
  "nos",
  "mon",
  "ma",
  "mes",
  "son",
  "sa",
  "ses",
]);

const MIN_TERM_LENGTH = 3;
const MAX_TERM_LENGTH = 30;
const MAX_KEYWORDS = 20;
const MIN_FREQUENCY = 2;

export interface WeightedField {
  text: string;
  weight: number;
}

export interface PageKeyword {
  term: string;
  weight: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(
      (word) =>
        word.length >= MIN_TERM_LENGTH &&
        word.length <= MAX_TERM_LENGTH &&
        !STOPWORDS.has(word),
    );
}

/**
 * Weighted term frequency across a page's fields (title, meta description,
 * H1s, body text), capped to the top MAX_KEYWORDS terms. Order is stable
 * (highest weight first) so downstream similarity comparisons are
 * deterministic.
 */
export function extractPageKeywords(fields: WeightedField[]): PageKeyword[] {
  const scores = new Map<string, number>();

  for (const field of fields) {
    if (!field.text) continue;
    for (const term of tokenize(field.text)) {
      scores.set(term, (scores.get(term) ?? 0) + field.weight);
    }
  }

  return Array.from(scores.entries())
    .filter(([, weight]) => weight >= MIN_FREQUENCY)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, MAX_KEYWORDS)
    .map(([term, weight]) => ({ term, weight }));
}
