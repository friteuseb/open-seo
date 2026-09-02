/**
 * Parsers for the internal-linking issue payloads. `detailsJson` is written by
 * the audit worker and read here, so it is validated rather than trusted: a
 * stale row from an older audit must not crash the view.
 */

import type { AuditResultsData } from "@/client/features/audit/results/types";

type AuditIssue = AuditResultsData["issues"][number];

export interface LinkSuggestionDetails {
  targetUrl: string;
  similarityScore: number;
}

export interface BrokenLinkDetails {
  targetUrl: string;
  targetStatus: number;
}

export function parseLinkSuggestionDetails(
  issue: AuditIssue,
): LinkSuggestionDetails | null {
  if (!issue.detailsJson) return null;
  try {
    const parsed: unknown = JSON.parse(issue.detailsJson);
    if (
      parsed &&
      typeof parsed === "object" &&
      "targetUrl" in parsed &&
      "similarityScore" in parsed &&
      typeof parsed.targetUrl === "string" &&
      typeof parsed.similarityScore === "number"
    ) {
      return {
        targetUrl: parsed.targetUrl,
        similarityScore: parsed.similarityScore,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function parseBrokenLinkDetails(
  issue: AuditIssue,
): BrokenLinkDetails | null {
  if (!issue.detailsJson) return null;
  try {
    const parsed: unknown = JSON.parse(issue.detailsJson);
    if (
      parsed &&
      typeof parsed === "object" &&
      "targetUrl" in parsed &&
      "targetStatus" in parsed &&
      typeof parsed.targetUrl === "string" &&
      typeof parsed.targetStatus === "number"
    ) {
      return { targetUrl: parsed.targetUrl, targetStatus: parsed.targetStatus };
    }
    return null;
  } catch {
    return null;
  }
}
