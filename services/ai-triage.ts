import type { PublicReport, AiPriority } from "@/lib/supabase-reports";
import { computeDedupeHash, normalizeDescription } from "@/lib/dedupe-hash";

export type { AiPriority };

export type TriageInput = {
  id: string;
  category: string;
  description: string;
  position: [number, number];
  createdAt?: string;
};

export type TriageResult = {
  priority: AiPriority;
  rationale: string;
  confidence: number;
  isSpam: boolean;
  isDuplicate: boolean;
  duplicateOfId?: string;
  dedupeHash: string;
};

const URGENT_KEYWORDS = [
  "sos",
  "help",
  "trapped",
  "drowning",
  "fire",
  "collapsed",
  "casualty",
  "dead",
  "injured",
  "evacuate",
  "rescue",
  "critical",
  "emergency",
  "sakuna",
  "baha",
  "lubog",
  "patay",
  "nasawi",
  "tulong",
];

const SPAM_PATTERNS = [
  /^(.)\1{8,}$/,
  /^(test|asdf|qwerty|hello|hi|lol|xxx)\b/i,
  /https?:\/\//i,
  /(.)\1{5,}/,
];

function looksLikeSpam(description: string) {
  const normalized = normalizeDescription(description);
  if (normalized.length < 3) return true;
  if (normalized.length < 8 && !/\d/.test(normalized)) return true;
  return SPAM_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksUrgent(category: string, description: string) {
  if (category === "SOS") return true;
  const haystack = `${category} ${description}`.toLowerCase();
  return URGENT_KEYWORDS.some((word) => haystack.includes(word));
}

export async function triageReportDeterministic(
  input: TriageInput,
  duplicateOfId?: string,
): Promise<TriageResult> {
  const dedupeHash = await computeDedupeHash({
    category: input.category,
    description: input.description,
    position: input.position,
  });
  return triageReportDeterministicSync(input, dedupeHash, duplicateOfId);
}

function triageReportDeterministicSync(
  input: TriageInput,
  dedupeHash: string,
  duplicateOfId?: string,
): TriageResult {
  if (duplicateOfId) {
    return {
      priority: "rejected",
      rationale: `Duplicate of report ${duplicateOfId} within the last 6 hours.`,
      confidence: 0.95,
      isSpam: false,
      isDuplicate: true,
      duplicateOfId,
      dedupeHash,
    };
  }

  if (looksLikeSpam(input.description)) {
    return {
      priority: "rejected",
      rationale: "Report appears to be spam or too low-signal for operations.",
      confidence: 0.85,
      isSpam: true,
      isDuplicate: false,
      dedupeHash,
    };
  }

  if (looksUrgent(input.category, input.description)) {
    return {
      priority: "urgent",
      rationale: "Life-safety keywords or SOS category detected.",
      confidence: 0.8,
      isSpam: false,
      isDuplicate: false,
      dedupeHash,
    };
  }

  return {
    priority: "low_priority",
    rationale: "Valid community report without immediate life-safety signals.",
    confidence: 0.65,
    isSpam: false,
    isDuplicate: false,
    dedupeHash,
  };
}

export async function triageReportDeterministicAsync(
  input: TriageInput,
  duplicateOfId?: string,
): Promise<TriageResult> {
  return triageReportDeterministic(input, duplicateOfId);
}

type LlmTriagePayload = {
  priority?: string;
  rationale?: string;
  confidence?: number;
  isSpam?: boolean;
  isDuplicate?: boolean;
};

function parseLlmJson(content: string): LlmTriagePayload | null {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate) as LlmTriagePayload;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as LlmTriagePayload;
    } catch {
      return null;
    }
  }
}

function normalizePriority(value: unknown): AiPriority {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "urgent") return "urgent";
  if (raw === "low_priority" || raw === "low") return "low_priority";
  if (raw === "rejected" || raw === "reject") return "rejected";
  return "low_priority";
}

export async function classifyReportWithLlm(
  input: TriageInput,
  duplicateOfId?: string,
): Promise<TriageResult | null> {
  const baseUrl = process.env.AERIS_CHAT_API_BASE_URL?.replace(/\/$/, "");
  if (!baseUrl) return null;

  const apiKey = process.env.AERIS_CHAT_API_KEY || process.env.LLM_API_KEY;
  const systemPrompt = [
    "You triage disaster reports for the Philippines AERIS platform.",
    "Respond with JSON only:",
    '{"priority":"urgent|low_priority|rejected","rationale":"string","confidence":0-1,"isSpam":boolean,"isDuplicate":boolean}',
    "Use rejected for spam, nonsense, or obvious duplicates.",
    "Use urgent for life-safety, SOS, trapped, fire, medical emergency, severe flooding with people at risk.",
    "Use low_priority for valid but non-urgent situational reports.",
  ].join(" ");

  const userContent = JSON.stringify({
    category: input.category,
    description: input.description,
    position: input.position,
    duplicateHint: duplicateOfId ?? null,
  });

  try {
    const response = await fetch(`${baseUrl}/api/llm/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { content?: string; message?: string };
    const content = data.content ?? data.message ?? "";
    const parsed = parseLlmJson(content);
    if (!parsed) return null;

    const dedupeHash = await computeDedupeHash({
      category: input.category,
      description: input.description,
      position: input.position,
    });

    const priority =
      duplicateOfId || parsed.isDuplicate
        ? "rejected"
        : parsed.isSpam
          ? "rejected"
          : normalizePriority(parsed.priority);

    return {
      priority,
      rationale:
        parsed.rationale?.slice(0, 500) ??
        (duplicateOfId ? `Duplicate of ${duplicateOfId}` : "LLM classification"),
      confidence: clampConfidence(Number(parsed.confidence ?? 0.7)),
      isSpam: Boolean(parsed.isSpam),
      isDuplicate: Boolean(parsed.isDuplicate || duplicateOfId),
      duplicateOfId,
      dedupeHash,
    };
  } catch {
    return null;
  }
}

export async function classifyReport(
  input: TriageInput,
  duplicateOfId?: string,
): Promise<TriageResult> {
  const llm = await classifyReportWithLlm(input, duplicateOfId);
  if (llm) return llm;
  return triageReportDeterministicAsync(input, duplicateOfId);
}

export function toTriageInput(report: PublicReport): TriageInput {
  return {
    id: report.id,
    category: report.category,
    description: report.description,
    position: report.position,
    createdAt: report.createdAt,
  };
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}
