# ZK / Chain-Agnostic Data Integrity — Status & Roadmap

Last updated: 2026-07-02.

AERIS's long-term goal is **chain-agnostic**: the ability to anchor
disaster-report attestations across multiple ZK, post-quantum-cryptography
(PQC), and hybrid/homomorphic-ZK (HZK) compatible chains, so that the
integrity/trust layer for citizen reports doesn't depend on any single
blockchain vendor. This report covers what's built and verified today, and
what's needed to bring in the two active integration tracks: **SKALE's
Levitation Protocol** and **PRISMO (BayaniChain)**.

## 1. What we have now

### 1.1 Working on-chain pipeline (SKALE-Base, live)

AERIS already mints verified disaster reports as ERC-1155 "Hypercert-shaped"
tokens on SKALE-Base (a standard, non-ZK SKALE chain):

```
operator verifies report (Dashboard)
  -> onchain_mint_status = 'queued'
  -> Postgres pg_net trigger -> /api/internal/onchain-mint (push, ~1s)
       (daily cron safety-net sweeps anything queued > 120s)
  -> services/onchain-mint-worker.ts
       -> builds token metadata, pins to IPFS
       -> mints AerisReports.sol (ERC-1155 + AccessControl) via viem
  -> tx hash + token id stamped back onto the report row
```

Key files: `lib/onchain/skale-base.ts` (network config), `lib/onchain/mint-client.ts`
(viem client), `contracts/src/AerisReports.sol`, `services/onchain-mint-worker.ts`,
`lib/onchain/mint-queue.ts`. Full detail in `lib/onchain/README.md`.

### 1.2 Privacy-minimized metadata (v2, shipped and verified)

The mint pipeline used to put **exact GPS (6 decimals), free-text description,
and an evidence photo pointer** directly into public, immutable token
metadata — a direct conflict with the Philippine Data Privacy Act's
data-minimization principle and the impossibility of ever correcting/erasing
data once minted. This has been replaced with a **salted commitment scheme**
(`lib/onchain/commitments.ts`):

- Public trait: coarse position (~111m precision), not exact GPS.
- Public trait: `geo_commitment = sha256(exact lng | exact lat | salt)`.
- Public trait: `description_commitment = sha256(description | salt)`.
- Public trait (when a photo exists): `photo_commitment = sha256(sha256(photo bytes) | salt)`.
- The static badge image is always used on-chain — raw evidence photos are
  never pinned to IPFS or referenced from a token anymore.
- The salt and exact values are persisted server-side only
  (`disaster_reports.geo_salt` / `geo_commitment` / `description_commitment` /
  `photo_commitment`, added in `supabase/migrations/20260701000000_report_privacy_commitments.sql`),
  never exposed via the public reports API.

This is important to be precise about: **this is a commitment scheme, not a
zero-knowledge proof system.** It lets AERIS later *reveal* the salt and exact
value to an authorized party who can then verify the hash matches — it does
not let a third party verify a claim ("this report is inside Barangay X")
*without* AERIS disclosing the salt. Building that (a real geofence/uniqueness
ZK circuit) is explicitly deferred — see Phase C in the migration plan and
§2.3 below.

**Verified end-to-end** on SKALE-Base testnet: synthetic report inserted →
queued → commitments computed → minted on-chain
(explorer: `base-sepolia-testnet-explorer.skalenodes.com`) → Supabase row
updated with tx hash, token id, and commitment columns. Independently
recomputed both `geo_commitment` and `description_commitment` from the raw
values + persisted salt and confirmed an exact hash match.

### 1.3 What's still single-chain / not yet chain-agnostic

The biggest gap relative to the "chain agnostic" goal: the entire pipeline is
hard-wired to one network (`AERIS_ONCHAIN_NETWORK=skale-base-{testnet,mainnet}`),
one contract address, and one minter private key. There is no adapter layer —
adding a second chain today would mean duplicating the mint worker, not
configuring a new target. See §2.3.

## 2. Upcoming integration

### 2.1 SKALE Dev team — Levitation Protocol testing

Researched directly against SKALE's own materials and GitHub before assuming
anything (sources at the bottom): **Levitation Protocol is not a live
network today.** It was first proposed in June 2023 and re-raised as a SKALE Improvement
Proposal in March 2025 alongside a broader concept called "SKALE G /
Ganymede." The actual implementation exists as two early-stage, unaudited
GitHub repos (`levitation_decentralized_zk_sequencer`,
`levitation_module_polygon_hermez` — single-digit commit counts, no releases).
SKALE's mainstream developer docs (docs.skale.space) don't mention it at all.

Architecturally, Levitation is a **decentralized sequencer** (`ZKQueue` /
`ZKProcessor` / `ZKBlocksStorage` / `ZKRelay` smart contracts) implementing a
**dual-chain model**: a "ZKChain" (high security, mainnet-anchored via
validity proofs) and a "FastChain" (high throughput, interactive), bridged
together. This is a materially different integration shape than our current
single-chain `AerisReports.sol` deployment.

### 2.2 PRISMO (BayaniChain) — Philippine government counterpart

Researched directly (sources below) rather than assumed, since this is a
named external partner and a government-adjacent claim:

- **BayaniChain** is a real, operating Philippine government blockchain
  deployment — the company (founded by Paul Soliman) is behind the
  Department of Budget and Management's blockchain system, which anchors
  Special Allotment Release Orders (SAROs) and Notices of Cash Allocation
  (NCAs) on-chain. This is reported as the first national government in Asia
  to apply blockchain to budget transparency at scale ("Digital Bayanihan
  Chain"). This makes PRISMO a credible, already-trusted government
  counterpart, not a hypothetical one.
- **PRISMO** is the orchestration/protocol layer within that system, publicly
  described (prismo.technology) as an **EVM-compatible L2 for sensitive data
  systems**, combining:
  - Zero-knowledge proofs ("confirm records are valid without disclosing what
    they contain"),
  - Homomorphic encryption ("verify encrypted data without seeing the private
    information inside"),
  - "Audit keys" letting approved third parties validate encrypted records
    without accessing the underlying sensitive data.
  - Target sectors explicitly listed: government, education, healthcare,
    finance, digital identity, logistics, IP, compliance/audit.

  This combination (ZK + homomorphic encryption + selective audit disclosure)
  is directly aligned with — and more advanced than — AERIS's current Phase 1
  commit-reveal scheme, and closer to what Phase C (deferred real ZK/selective
  disclosure work) is aiming for.

  - Integration/partnership process: currently only a public early-access
    waitlist on prismo.technology — no SDK or integration docs are public.

**Why this matters strategically**: PRISMO/BayaniChain is already trusted
infrastructure for PH government financial data. Anchoring AERIS disaster-
report commitments on a chain PH government stakeholders (LGUs, DBM,
disaster-response agencies) already recognize directly strengthens both the
Data Privacy Act compliance story (government-vetted infrastructure, not a
foreign chain) and the future monetization story (LGU/government customers
may specifically prefer PRISMO-anchored data provenance).


### 2.3 Chain-agnostic architecture (the connecting piece)

Both tracks above are currently pre-integration (contact/access-gated, not
code-gated). Before wiring up either one, we should design a **chain adapter
abstraction** so we don't repeat the SKALE-Base pattern of hard-coding a
single network end-to-end a second time. Concretely:

- `lib/onchain/commitments.ts` (coarsening + salted SHA-256 commitments) is
  already chain-agnostic by construction — it doesn't depend on any
  chain-specific cryptography, only on `crypto.subtle.digest`.
- `lib/onchain/hypercert-metadata.ts` is also chain-agnostic — it just builds
  a JSON document.
- The chain-specific parts are narrowly `lib/onchain/skale-base.ts` (network
  config) and `lib/onchain/mint-client.ts` (viem-specific transaction
  submission). These are the two files that would need a generic
  `ChainAdapter` interface (network config + submit-transaction +
  read-mint-status) so the same mint worker can target SKALE-Base,
  Levitation, PRISMO, or a future chain by configuration, not by
  duplicating `services/onchain-mint-worker.ts`.
- Real ZK circuits (Phase C, still deferred) would layer in *on top of*
  whichever chain(s) actually expose usable ZK verification tooling —
  PRISMO's public description suggests it may be further along here than
  Levitation's current prototype stage, but this needs direct technical
  confirmation from PRISMO, not an assumption from their marketing copy.

## Summary / recommended next steps

1. **Design the `ChainAdapter` abstraction** (§2.3) before writing integration
   code for either partner, so the SKALE-Base-specific mint worker becomes
   the first of several adapters rather than a pattern we duplicate.
2. Treat real ZK circuit work (geofence/uniqueness proofs) as gated on which
   partner chain(s) actually provide usable ZK tooling — decide after both
   conversations above, not before.

## Sources consulted

- [SKALE: Introducing the Levitation Protocol](https://blog.skale.space/blog/introducing-the-levitation-protocol-skales-solution-for-decentralized-zero-knowledge-proofs)
- [The Block: Skale Network introduces Ethereum ZK-Rollup Levitation Protocol](https://www.theblock.co/post/232622/skale-network-introduces-ethereum-zk-rollup-levitation-protocol)
- [SKALE Forum: Levitation protocol research paper](https://forum.skale.network/t/exciting-levitation-protocol-research-paper/461)
- [github.com/skalenetwork/levitation_decentralized_zk_sequencer](https://github.com/skalenetwork/levitation_decentralized_zk_sequencer)
- [github.com/skalenetwork/levitation_module_polygon_hermez](https://github.com/skalenetwork/levitation_module_polygon_hermez)
- [PRISMO](https://prismo.technology/)
- [BitPinas: Webcast Recap — Bayanichain and BetterGov Founders Clash Over PH Government Blockchain Strategy](https://bitpinas.com/webcast/government-blockchain-webcast)
- [DICT: Digital Bayanihan Chain — PH national budget on blockchain](https://dict.gov.ph/news-and-updates/25385)
- [Tatler Asia: Inside the blockchain tech making the Philippines' national budget tamper-proof](https://www.tatlerasia.com/power-purpose/innovation/paul-soliman-blockchain-bayanichain)
- [BitPinas: Baguio City to Pilot GoodGovChain — BayaniChain](https://bitpinas.com/regulation/baguio-goodgovchain/)
