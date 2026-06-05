import { buildExplainPrompt, type HelpId } from "@/config/help-content";

export const AGENT_EXPLAIN_EVENT = "aeris:agent-explain";

export type AgentExplainDetail = {
  helpId: HelpId;
  prompt: string;
};

/**
 * A controlled "explain" request passed down the panel tree (page ->
 * BottomPanel -> CommunityChatPanel -> AgentAerisPanel). The `id` changes on
 * each request so consumers can react even when the prompt repeats.
 */
export type AgentExplainRequest = {
  id: number;
  prompt: string;
};

/**
 * Dispatches a window event requesting Agent AERIS explain a given help topic.
 * The dashboard shell (app/page.tsx) listens for this, opens the agent panel,
 * and forwards the prompt so the reply is shown in chat and spoken aloud.
 */
export function requestAgentExplain(helpId: HelpId): void {
  if (typeof window === "undefined") return;
  const detail: AgentExplainDetail = {
    helpId,
    prompt: buildExplainPrompt(helpId),
  };
  window.dispatchEvent(
    new CustomEvent<AgentExplainDetail>(AGENT_EXPLAIN_EVENT, { detail }),
  );
}
