/**
 * Weighted keyword extraction for internal-linking similarity.
 *
 * Produces a small, bounded set of significant terms per page (not the raw
 * body text) so similarity can be computed later without persisting a large
 * text blob per page. Title/H1/meta description are repeated in proportion
 * to their weight before tokenizing, the same trick a plain TF-IDF corpus
 * uses to bias term frequency toward the fields that best describe a page.
 */

import { sort } from "remeda";

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
  // Common fillers that carry no topical signal; they surfaced as theme
  // labels ("pas", "vous") once clustering started naming clusters.
  "not",
  "can",
  "will",
  "would",
  "should",
  "have",
  "has",
  "had",
  "all",
  "more",
  "most",
  "when",
  "how",
  "what",
  "which",
  "who",
  "there",
  "their",
  "they",
  "them",
  "than",
  "then",
  "some",
  "such",
  "any",
  "each",
  "also",
  "just",
  "only",
  "very",
  "out",
  "over",
  "after",
  "before",
  "here",
  "other",
  "many",
  "much",
  "make",
  "made",
  "get",
  "one",
  "two",
  "use",
  "using",
  "used",
  "new",
  "see",
  "may",
  "own",
  "via",
  "pas",
  "vous",
  "nous",
  "plus",
  "tout",
  "toute",
  "bien",
  "comme",
  "sans",
  "aussi",
  "peut",
  "peuvent",
  "faire",
  "fait",
  "cette",
  "cet",
  "ils",
  "elle",
  "elles",
  "encore",
  "tres",
  "entre",
  "avoir",
  "avez",
  "avant",
  "apres",
  "chaque",
  "autre",
  "autres",
  "meme",
  "memes",
  "deux",
  "dont",
  "celui",
  "cela",
  "sous",
  "lors",
  "ainsi",
  "toujours",
  "jamais",
  "beaucoup",
  "moins",
  "doit",
  "doivent",
  "etes",
  "sera",
  "seront",
  "chez",
  "vers",
  "depuis",
  "pendant",
  "afin",
  "car",
  "ici",
  "non",
  "oui",
  "passe",
  "faut",
  "sais",
  "voir",
  "mettre",
  "prendre",
  "donner",
  "laisser",
  "garder",
  "trouver",
  "savoir",
  "vient",
  "viennent",
  "reste",
  "restent",
  "suffit",
  "permet",
  "permettent",
  "existe",
  "devient",
  "deviennent",
  "selon",
  "dessus",
  "dessous",
  "fois",
  "chose",
  "choses",
  "facon",
  "maniere",
  "moment",
  "cas",
  "type",
  "sorte",
  "partie",
  "exemple",
  "point",
  "cote",
  "lieu",
  "sujet",
  "raison",
  "effet",
]);

const MIN_TERM_LENGTH = 3;
const MAX_TERM_LENGTH = 30;
const MAX_KEYWORDS = 20;
const MIN_FREQUENCY = 2;

interface WeightedField {
  text: string;
  weight: number;
}

export interface PageKeyword {
  term: string;
  weight: number;
}

function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      // NFKD splits an accented letter into a base letter plus a combining
      // mark, and a combining mark is not \p{L}. Without dropping the marks
      // first, the next replace turns them into spaces and cuts accented words
      // in half — "légumes" became "gumes", "récolte" became "colte". Stripping
      // them also matches the accent-free spellings in STOPWORDS.
      .replace(/\p{M}+/gu, "")
      .replace(/[^\p{L}\s]/gu, " ")
      .split(/\s+/)
      .filter(
        (word) =>
          word.length >= MIN_TERM_LENGTH &&
          word.length <= MAX_TERM_LENGTH &&
          !STOPWORDS.has(word),
      )
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

  return sort(
    Array.from(scores.entries()).filter(
      ([, weight]) => weight >= MIN_FREQUENCY,
    ),
    (a, b) => b[1] - a[1],
  )
    .slice(0, MAX_KEYWORDS)
    .map(([term, weight]) => ({ term, weight }));
}
