# AERIS Dashboard → AERIS Chat (Agent Backend)

The dashboard does **not** call any LLM provider directly. Every AI feature
in this repo proxies through the AERIS CHAT app, which implements the frozen
HTTP contract documented in the chat repo at
`docs/AGENT_CONTRACT.md`.

## Required environment

| Variable | Where | Purpose |
|----------|-------|---------|
| `AERIS_CHAT_API_BASE_URL` | this repo | Base URL of the deployed AERIS CHAT (e.g. `https://aeris-chat.vercel.app`). No trailing slash. |
| `AERIS_CHAT_API_KEY`      | this repo | Bearer secret. **Must equal** `LLM_API_KEY` set on the AERIS CHAT project. Falls back to `LLM_API_KEY` env if unset. |

There is intentionally **no** `NVIDIA_API_KEY` or `LLM_MODEL` in this repo —
those live only on AERIS CHAT.

## Call sites

Every place in the dashboard that consumes the agent contract:

| File | What it does | Calls |
|------|--------------|-------|
| [`app/api/agent-aeris/chat/route.ts`](../app/api/agent-aeris/chat/route.ts) | Operator-facing Agent AERIS chat panel | `POST {AERIS_CHAT_API_BASE_URL}/api/llm/chat` |
| [`services/ai-triage.ts`](../services/ai-triage.ts) | AI classification of incoming disaster reports (`classifyReportWithLlm`) | `POST {AERIS_CHAT_API_BASE_URL}/api/llm/chat` |
| [`services/weather-report-compose.ts`](../services/weather-report-compose.ts) | LLM-authored national weather briefs (`composeLlmWeatherReport`) | `POST {AERIS_CHAT_API_BASE_URL}/api/llm/chat` |
| [`app/api/agent/reply/route.ts`](../app/api/agent/reply/route.ts) | Operator back-channels a reply into the originating citizen chat session | `POST {AERIS_CHAT_API_BASE_URL}/api/chat/system-message` (not `/api/llm/chat`, but the same secret pairing applies via `INTERNAL_TRIAGE_SECRET`) |

All four use the same contract response shape (`message`, `content`,
`provider`, `model`) and the same bearer auth model.

## Error handling expectations

Per the contract, branch only on HTTP status codes (`401`, `502`, `503`,
`504`, `500`). Do not depend on exact error strings. All current call sites
follow this rule.

## Changing the contract

If `/api/llm/chat` in AERIS CHAT changes, every file in the table above must
be re-verified. There is no shared package — the HTTP contract is the source
of truth. See the chat repo's `docs/AGENT_CONTRACT.md`.

## Out of scope (next PR candidates)

These will land without breaking the current contract:

- `GET /api/llm/capabilities` to enumerate tools/skills.
- Tool-calling loop (the LLM can call `lookup_typhoon_signal`,
  `find_nearest_evacuation_center`, `propose_incident_draft`).
- Streaming responses (SSE).
- MCP server exposing AERIS data to external agents.
- Provider abstraction inside chat's `lib/nvidia-llm.ts` for swapping to a
  self-hosted Hermes/OpenChat endpoint.
