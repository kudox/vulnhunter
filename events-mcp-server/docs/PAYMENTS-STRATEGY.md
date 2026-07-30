# Payments Strategy

*Decided 2026-07-29. Question answered: when LastCall "handles payments," how
does money wire into merchant/platform systems — direct processing, their
APIs, or affiliate links?*

**The answer differs by inventory lane. For two of the three lanes, the right
move is deliberately NOT being in the money flow.**

| Lane | Inventory | Money mechanism | LastCall's cut |
|---|---|---|---|
| 1 | Direct-merchant offers (restaurants, studios, independent venues) | **Stripe Connect** — agent pays through LastCall, payout routed to merchant | 12% `application_fee` at charge time |
| 2 | Platform-connected merchants (Eventbrite today) | **Promo-code rail** — single-use discount codes minted via the merchant's connected account; checkout stays on the platform | Fee per redeemed code, billed monthly |
| 3 | OSINT listings (Ticketmaster, etc.) | **Affiliate-tagged link-outs** where programs exist; plain attributed links otherwise | ~1% affiliate pennies (garnish, not revenue) |

## Lane 1 — Direct offers: Stripe Connect, and no merchant-system integration at all

The core realization: for non-platformed merchants there is **no system to
wire into**. The merchant honors a redemption code at the door; the money is
between the customer, LastCall, and the merchant.

- Architecture: **Stripe Connect destination charges**. The customer's agent
  pays LastCall's Stripe account; funds route to the merchant's connected
  account with the 12% platform fee taken as `application_fee_amount`.
- The **merchant is merchant-of-record**: their name on the customer's
  statement, their refund/chargeback liability. LastCall is the platform, not
  the seller — this matters for taxes, disputes, and trust.
- Stripe's agentic/machine-payments layer (MPP) sits on top for
  agent-initiated checkout; the `events_confirm_redemption` tool is where
  the charge executes.
- Merchant onboarding = Stripe Connect Express account creation, folded into
  merchant signup.

This is the only lane where LastCall processes payments, and it is entirely
within our control — the actual "payments milestone."

## Lane 2 — Eventbrite-connected merchants: the promo-code rail (no payments at all)

Fighting a ticketing platform's closed checkout is a losing move — and
unnecessary. Eventbrite gives organizers a discounts/coupon API and per-event
tracking links, and these merchants have already connected their account.

**Flow:** at claim time, LastCall mints a **single-use Eventbrite discount
code through the merchant's own account** (discount depth from the promotion
rule). The user completes checkout on Eventbrite with that code. Attribution
is airtight — the code is unique to the claim, and redemption is readable via
the same ticket-class API the sync already uses. LastCall bills the merchant
per redeemed code (monthly Stripe invoice).

Why this beats processing payment ourselves for this lane:

1. Zero payment processing, zero merchant-of-record exposure.
2. Customer checks out somewhere they already trust.
3. **Kills the double-sell problem** (WORKLOG 2026-07-25 gotcha): Eventbrite's
   own inventory system decrements — there is no parallel ledger to drift.
4. The fee is enforced by data both parties can independently verify.

Likely ships **before** Lane 1: it is less work, reuses existing integration
surface, and makes current Eventbrite offers monetizable end-to-end.

## Lane 3 — OSINT listings: affiliate tags as a garnish, never a business

- Ticketmaster runs a real affiliate program via **Impact** (30-day cookie),
  but economics are ~**1% per sale / ~$0.30 flat** in some tiers. On a $60
  ticket: **$0.60 affiliate vs $7.20 at our 12% redemption fee** — two orders
  of magnitude worse than the core model.
- Action: swap plain Ticketmaster link-outs for Impact-tagged links (URL
  parameter, near-zero engineering); same for SeatGeek/StubHub if they become
  sources. Click-through data is itself another analytics stream.
- Eventbrite has no meaningful central affiliate program today; organizer-level
  tracking links exist but Lane 2 supersedes them for connected merchants.
- **Strategic guardrail:** listings are the demand moat and merchant-acquisition
  funnel. Never optimize them for affiliate pennies (e.g., ranking by
  commission would poison agent trust for cents).
- Compliance note: affiliate ToS often restrict paid placement / sub-affiliate
  arrangements — review before tagging links that render inside sponsored
  contexts.

## Watch item: agentic checkout protocols

Stripe MPP, and the agent-commerce integrations major platforms are shipping,
will eventually let agents complete ticket purchases natively. When
Ticketmaster (or a peer) exposes agent-native checkout, Lane 3 converts from
"link out" to "complete the purchase in-conversation" — and LastCall's
position as the discovery layer holding demand data is the asset that makes
us a launch partner rather than a bystander. Do **not** pursue Ticketmaster's
restricted Partner/commerce APIs now: gated to large approved resellers, slow
approval, and the affiliate link provides distribution presence meanwhile.

## Build order

1. **Eventbrite promo-code rail** (Lane 2) — smallest step to real revenue on
   existing integration surface.
2. **Stripe Connect** (Lane 1) — merchant onboarding + destination charges +
   fee-at-source in `confirm_redemption`.
3. **Affiliate tagging** (Lane 3) — an afternoon; monitor, don't strategize.
4. Re-evaluate on any agentic-checkout announcement from ticketing platforms.

## Sources

- Ticketmaster affiliate program (Impact, rates): https://getlasso.co/affiliate/ticketmaster/ · https://taprefer.com/ticketmaster-affiliate-program/ticketmaster/ · https://linkclicky.com/affiliate-program/ticketmaster/
- Eventbrite organizer affiliate links & coupon/discount APIs: https://www.postaffiliatepro.com/integration-methods/eventbrite/ · https://www.idevaffiliate.com/eventbrite/
