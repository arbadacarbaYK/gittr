## Context

[NIP-34](https://github.com/nostr-protocol/nips/blob/master/34.md) defines git issues (`1621`) and pull requests (`1618`). [gittr.space](https://gittr.space) ships production **Lightning bounties on issues** using a custom kind **9806** with host-side **LNURL-withdraw** settlement (LNbits today; rail should stay pluggable).

This is **not** the same model as the closed [NIP-43 Bounties PR #865](https://github.com/nostr-protocol/nips/pull/865) (Resolvr / ChristianChiarulli — **not** a gittr PR): that proposal used replaceable bounty-board states and assignment. gittr anchors bounties to **NIP-34 issues**, releases on **PR merge**, and settles via LNURL-withdraw.

## Proposal

Document an optional **NIP-34 companion** (or small NIP) for issue-scoped bounties rather than reviving NIP-43 as-is.

**Implementation profile (reference):**
- https://github.com/arbadacarbaYK/gittr-helper-tools/blob/main/snippets/nip34-issue-bounties/README.md
- Event kind `9806`
- **Tags:** `e` (issue + marker `issue`), `repo`, `status`, `p` (`creator` / optional `claimed_by`)
- **Content JSON** (not tags): `amount`, `withdrawId`, `lnurl`, `withdrawUrl`, optional legacy `invoice` / `paymentHash`
- **Production happy path:** `paid` → `released` (claimer redeems withdraw URL). `pending` is mainly the cancel/clear path. `claimed` is optional / not required on Nostr today.

## Questions for ecosystem

1. Is `9806` acceptable or should bounties use a different kind / NIP-32 labels?
2. Should we standardize on LNURL-withdraw vs zap-split (NIP-57) for merge payouts?
3. Would ngit / gitworkshop / other NIP-34 clients adopt a shared profile if documented?

## gittr status (as of 2026-07-18)

- Publishes `9806` from the client on offer / merge / cancel
- Offer usually lands at **`paid`** (withdraw created in the same flow)
- Merge republishes **`released`** + `claimed_by` = PR author; claimer opens `withdrawUrl`
- **Bounty-hunt UI is localStorage-only** today (no relay-wide `9806` index yet — planned)
- Relays need `9806` in `allowed_kinds` (documented in gittr `NIPS_AND_EVENT_KINDS.md`)

Happy to adjust the profile from feedback here before proposing a NIP draft.
