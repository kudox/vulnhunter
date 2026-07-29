# Merchant Pilot Playbook

*Drafted 2026-07-29. Companion to [PAYMENTS-STRATEGY.md](./PAYMENTS-STRATEGY.md).
This is the supply-side plan: how to sign the first 10 merchants without a
sales background, a payments stack, or a leap of faith from anyone.*

**Operating principle: at every step, the merchant risks nothing they didn't
explicitly cap, and the ask is small enough to accept on the spot.**

---

## 1. The trust ladder (crawl → walk → run)

| Stage | Money flow | Merchant's operational change | What it proves |
|---|---|---|---|
| **Crawl** — pilot | Pay at the door; LastCall handles no money; pilot is **free for 60 days** | Staff honors a code for a discount the merchant set | Redemptions happen; codes get honored; demand is real |
| **Walk** — paid | Customer prepays via Stripe Connect; merchant paid out weekly minus 12% | Same code at the door, but the party already paid | Merchants prefer prepay (no-shows still pay); fee tolerated because value is proven |
| **Run** — scaled | Prepay + per-merchant rules engine | None — offers generate themselves from dead inventory | The product works without hand-holding |

Do not skip crawl. The pilot's job is to manufacture the proof (redemption
stats) that makes the paid ask trivial — and to find the operational potholes
while nothing is at stake.

## 2. Pilot design

- **Size**: 5–10 merchants, one city, ideally clustered (walkable follow-ups,
  and agents searching one neighborhood see real density).
- **Duration**: 60 days free, then convert or part friends.
- **Onboarding**: manual. You are the merchant dashboard — collect their offer
  parameters (discount, quantity cap, valid windows, blackout days, terms) in
  a 10-minute conversation and enter them into the seed/config yourself.
  Building merchant tooling before merchants exist is procrastination.
- **The weekly email** (non-negotiable): every Monday, each merchant gets
  their numbers — searches their offer appeared in, claims, redemptions,
  revenue at the door. This is simultaneously the retention mechanism, the
  conversion evidence, and the **demand-intelligence product's first draft**.
  Zero redemptions in week one? The email still runs ("appeared in 214 agent
  searches") — visibility is a result too.
- **Geography note**: Lane-1 walk-ins are in-person work — consider piloting
  where your feet are (Sacramento) even while the OSINT/listings demand layer
  builds the SF story. Lane-2 Eventbrite merchants can be signed remotely by
  email in any city. The two tracks don't need to share a city.

## 3. Who to pitch (in order)

1. **Comedy clubs / small venues** — the anchor vertical. The industry term
   "papering the room" exists because they *already* give away seats to fill
   shows; you're automating an existing habit, not creating one.
2. **Owner-operated restaurants & bars with a dead window** (the 3–6pm lull,
   slow weeknights). Owner-operated matters: the decision-maker is behind the
   counter. Skip anything with a corporate office.
3. **Fitness/wellness studios** (off-peak classes, intro-friendly, high
   margin on an empty mat).
4. Skip for now: anything requiring franchise/HQ approval, and anywhere
   already at capacity during your target windows (nothing to sell them).

Expect **~3 yeses per 10 asks**. That's a good rate, not a bad one.

## 4. The approach

- **Walk in during their dead hours.** The empty room at 3pm is the pitch —
  you're offering to fix the exact thing both of you are looking at.
- Ask for the owner or manager. If unavailable, leave the one-pager and get a
  name; return, don't call.
- **The 60-second pitch** (Appendix A has the full script): *"AI assistants
  are becoming how people decide what to do tonight. I run a service those
  assistants search. I'd like to send you customers during your slow hours,
  at a discount you set, capped at a number you set — free for 60 days, and
  you can quit by text message. Customers pay you directly. All I need is
  ten minutes to set up your offer."*
- Handle the two universal objections:
  - *"Discounts cheapen my brand"* → capped, time-boxed, and invisible except
    to the parties who claim them — this is yield management, not a coupon
    site. There's no public "deals page" with their name on it.
  - *"Groupon burned me"* → that's the design brief. Caps they set, windows
    they set, new-customer flags if they want, and they can stop any day.
- Close by doing the setup on the spot (10 minutes, their parameters), and
  leave with: signed one-pager, offer config, staff instructions (Appendix C),
  and their preferred contact for the weekly email.

## 5. The Eventbrite variant (Lane 2 — remote, email-first)

For merchants whose ticketing is on Eventbrite (SF and anywhere else),
no walk-in needed:

- Source the list from our own ingest: organizers whose events consistently
  show low sell-through (the snapshot data literally generates the prospect
  list and the pitch: *"your last 4 Thursday shows averaged 38% sold"*).
- Ask: email → 15-minute call → they either connect via OAuth or, lower rung,
  create a batch of discount codes themselves and send them over.
- Their door operation changes not at all: buyers check out on Eventbrite,
  tickets scan like any other ticket.
- Same free-60-days structure; fee-per-redeemed-code afterward.

## 6. The make-good policy (why anyone trusts the claim button)

If a merchant refuses a valid code: the customer is refunded/comped
immediately by LastCall, no questions; the merchant gets one conversation,
then delisting. Budget for it as a pilot cost — realistic exposure at pilot
scale is a few hundred dollars, and it buys the only thing that matters:
an agent's user never gets burned twice.

## 7. Success criteria (decide before starting)

Pilot "converts" a merchant if, by day 60:
- ≥10 redemptions attributable to LastCall for that merchant, and
- the merchant opts into the paid tier (12% prepaid or per-redemption fee)
  when asked plainly.

Pilot succeeds overall if ≥3 merchants convert. If redemptions happen but
conversions don't, the fee is mispriced — learn and adjust. If redemptions
don't happen, the demand side isn't ready for Lane 1 — double down on
listings/distribution and re-run the pilot later. Both outcomes are
information; only not running the pilot is failure.

---

## Appendix A — Walk-in pitch script

> "Hi — do you have two minutes? I'm [name], I run a local service called
> LastCall.
>
> Quick version: people are starting to ask AI assistants — ChatGPT, Claude —
> 'what should we do tonight?' My service is what those assistants search to
> answer that. Right now I list events all over the city for free.
>
> Here's why I walked in: it's [3pm] and you've got empty [seats/mats/tables].
> Those are worth zero the moment [the show starts / the hour passes]. I'd
> like to send you customers during exactly these windows, at a discount you
> choose, capped at a number you choose. They show a code, you honor the
> discount, they pay you directly.
>
> It's free for 60 days — I'm proving this works. Every Monday you get an
> email with your numbers. If it's not filling seats, quit by text message,
> no hard feelings. If it is, we talk about a small fee per party I send.
>
> Ten minutes to set up your first offer?"

## Appendix B — One-page pilot agreement (template — have a lawyer review before real use)

> **LastCall Pilot Agreement**
>
> Between **[Merchant legal name]** ("Merchant") and **[Your name / entity]**
> ("LastCall"), effective [date].
>
> 1. Merchant authorizes LastCall to publish promotional offers for Merchant
>    with these parameters, changeable by Merchant at any time with 24 hours'
>    notice: offer description, discount, price, valid days/times, maximum
>    redemptions per day and per pilot, and any restrictions (e.g.
>    new customers only).
> 2. Merchant will honor valid LastCall redemption codes presented within the
>    offer's parameters. Customers pay Merchant directly at the promotional
>    price. LastCall handles no customer funds during the pilot.
> 3. Pilot fee: **$0 for 60 days** from the effective date. Afterward, any
>    continued service requires a separate written agreement — neither party
>    is obligated to continue.
> 4. LastCall will provide Merchant a weekly performance summary and will not
>    use Merchant's name or marks outside the offer listing itself without
>    permission.
> 5. Either party may terminate at any time, by any written means (including
>    text message). Codes claimed before termination and within their validity
>    window will be honored.
> 6. No exclusivity; no minimum volumes; Merchant owns all customer
>    relationships.
>
> Signed: ______________ (Merchant) ______________ (LastCall)

## Appendix C — Staff instruction card (leave at the register)

> **LastCall customers** will show a code on their phone like **LC-4F7A2B**.
> 1. Check the offer: [offer name, discount, valid window] — parameters on
>    the back of this card.
> 2. Apply the discount, ring them up normally — they pay us nothing, they
>    pay you.
> 3. Tally it on this card (or tell [manager]) so the count matches our
>    weekly email.
> Questions / problems: text [your number] — I answer fast.
