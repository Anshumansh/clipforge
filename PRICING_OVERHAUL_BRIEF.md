# Clipforge Pricing & Credit System Overhaul — Owner Brief

Verbatim brief provided 2026-08-11. Saved here so it survives context resets; do not
edit the content below except to append an amendment with its own date. Execution
status, decisions, and outputs are tracked in `PRICING_MODEL.md`, `UNIT_ECONOMICS.md`,
`CREDIT_RULES.md`, `STRIPE_PRODUCT_MAPPING.md`, `CUSTOMER_MIGRATION.md`,
`PRICING_DEPLOYMENT_CHECKLIST.md`, and `OWNER_ACTIONS_REQUIRED.md`.

---

Analyse the entire Clipforge repository and implement a profitable, competitive pricing and credit system. Inspect the current database, Stripe integration, subscription plans, credit deductions, rendering jobs, API/MCP access and pricing pages before changing anything.

Do not invent costs, margins, competitor information or feature availability. Use backward-compatible migrations, automated tests and a staged deployment. Do not modify production Stripe products or deploy to production without owner approval.

## 1. New monthly pricing

Implement these USD plans:

**Free — $0**
- 20 one-time credits after email verification
- Approximately two standard trial videos
- Watermark
- 720p
- Maximum 30 seconds
- Standard script-to-video only
- No repurposing, UGC ads, voice cloning, 4K, teams or API
- One anonymous demo maximum, protected by CAPTCHA, IP/account limits and a daily company-wide spending ceiling

**Starter — $15/month**
- 250 monthly credits
- Up to 25 standard videos
- 1080p
- No watermark
- Standard voices, captions, b-roll and hook scoring
- One brand preset
- Standard queue
- No voice cloning, 4K, teams or API

**Creator — $29/month**
- 600 monthly credits
- Up to 60 standard videos
- Everything in Starter
- Long-form repurposing
- UGC-style ads
- Multiple aspect ratios
- Two brand presets
- Priority queue
- 30-day media retention
- Social publishing only for platforms verified as operational

**Pro — $59/month**
- 1,500 monthly credits
- Up to 150 standard videos
- Everything in Creator
- 4K and voice cloning available at higher credit costs
- Five brand presets
- Two users
- Limited API/MCP
- Premium queue
- 60-day retention

**Business — $119/month**
- 3,500 monthly credits
- Up to 350 standard videos
- Everything in Pro
- Five users
- Ten brand presets
- Shared workspace
- Higher but limited API/MCP use
- Highest normal queue priority
- 90-day retention
- No unlimited rendering, storage, transcription, voice cloning or API use

**Enterprise — Custom.** Only show features genuinely available. Do not claim SOC 2, ISO, SSO, SLA, data residency or dedicated infrastructure unless verified.

## 2. Annual pricing

Use a maximum 20% discount:
- Starter: $144/year
- Creator: $278/year
- Pro: $566/year
- Business: $1,142/year

Release annual-plan credits monthly. Do not grant all annual credits immediately.

## 3. Credit costs

Create one canonical server-side credit calculator used by the website, API, MCP, dashboard and rendering worker.

Initial costs:
- Standard 30–45 second video: 10 credits
- 46–60 second video: 15 credits
- 61–90 second video: 25 credits
- UGC-style ad: 15 credits
- Premium TTS: +3 credits
- Additional aspect ratio: +3 credits
- 4K export: +15 credits
- Voice cloning: at least +30 credits
- Repurposing: 2 credits per uploaded source minute
- Each completed repurposed clip: +10 credits
- Thumbnail: 1 credit
- Full customer-requested re-render: normal cost
- System-failed render: automatic full refund
- Duplicate/retried system job: never charge twice

Example: a 30-minute upload producing five clips costs 60 source-processing credits plus 50 clip credits, or 110 total credits.

Display the exact cost before generation. Remove all claims that "one credit equals one minute."

## 4. Extra purchases

Add credit packs:
- 100 credits: $9
- 500 credits: $39
- 1,500 credits: $99
- 5,000 credits: $279 for approved Business/Enterprise accounts

Add additional seats at $8 per user per month.

Credit packs must not bypass plan restrictions or safety controls. Clearly disclose expiry and refund treatment.

## 5. Competitor positioning

Use current official competitor pricing only as a dated internal benchmark:
- OpusClip: approximately $15 Starter and $29 Pro
- Revid.ai: approximately $39 entry/growth and $199 Ultra
- Klap: annual equivalents around $14 Basic, $39 Pro and $94 Pro+
- Vizard: verify its dynamic pricing before comparison

Competitor credits are not directly comparable. Some charge by uploaded minute and others by clip. Never claim Clipforge is cheaper or gives more videos unless a verified like-for-like comparison proves it.

Store competitor source URLs and verification dates. Hide comparison data after 30 days without re-verification.

## 6. Track every expense

Record per generation:
- AI model and provider
- Input/output tokens
- Transcription minutes and cost
- TTS duration/characters and cost
- Voice-cloning compute
- Render time, CPU and memory
- Storage
- Download bandwidth
- Retries and failed-attempt cost
- Credits charged/refunded
- Net revenue allocated to the job

Track monthly expenses:
- Hetzner servers and render workers
- Neon database
- Backblaze storage and backups
- OpenAI and Groq
- Stripe and currency conversion
- Resend
- Domain
- Monitoring
- Accounting
- Legal
- Insurance
- Support
- Development
- Marketing
- Refunds and chargebacks
- GST/tax configuration

Do not invent missing expense values. Mark them for owner input.

## 7. Profitability safeguards

Target at least 70% contribution margin at full legitimate usage.

Use: Contribution margin = net revenue − AI − transcription − TTS − rendering − storage/egress − Stripe fees − refunds/chargebacks − other direct costs.

Maximum safe variable cost per credit: Net plan revenue × 30% ÷ included credits.

Create dashboards by job, customer, feature and plan.

Add alerts when:
- Plan margin falls below 70%
- Margin falls below 50% critically
- One job costs more than its allocated revenue
- Retries exceed 10% of production cost
- Customer cost exceeds 30% of net subscription revenue
- Daily provider or free-demo spending reaches its limit

Add global and per-feature kill switches for demos, voice cloning, 4K, repurposing and social publishing.

Do not depend on customers leaving credits unused. If a plan is unprofitable at full use, recommend increasing operation credits, reducing allowance, increasing price or disabling the expensive feature.

## 8. Credit and database integrity

Implement:
- Immutable credit ledger
- Atomic credit reservations
- Capture after successful completion
- Exact-once refunds
- Idempotency keys
- Credit-expiry records
- Stripe webhook event records
- Job-level cost records
- Plan versioning
- Customer grandfathering
- Admin adjustment audit logs

Prevent:
- Negative balances
- Concurrent double spending
- Duplicate webhook grants
- Duplicate retry charges
- Cross-workspace usage
- Refund abuse

## 9. Stripe requirements

Implement in Stripe test mode first:
- Monthly and annual products
- Credit packs
- Additional seats
- Signed webhook verification using the raw body
- Idempotent event processing
- Checkout, renewal, payment failure, upgrade, downgrade, cancellation, refund and dispute handling
- Self-service billing portal
- Clear recurring-payment disclosure
- Monthly credit reset only after successful payment
- Reconciliation between Stripe and local subscription state

Do not grant credits from the success-page redirect alone.

Do not decide GST treatment in code. Make it configurable and list ABN/GST confirmation as an accountant/owner action.

## 10. Pricing-page requirements

Show:
- USD price
- Monthly and annual billing
- Included credits
- Honest "up to" video examples
- Credit cost by workflow
- Included seats
- Retention period
- Feature restrictions
- Credit reset and expiry
- Additional-credit pricing
- Automatic renewal and cancellation
- Tax wording from verified configuration

Use this explanation: "Standard 30–45 second videos use 10 credits. Long uploads, voice cloning, 4K and additional outputs use more credits. Clipforge shows the exact cost before every generation."

Do not advertise unavailable features, unlimited use or incomparable competitor credits.

## 11. Existing subscribers

Do not unexpectedly change existing customers.

Create:
- Versioned plans
- Existing-customer impact report
- Temporary grandfathering support
- Old-versus-new revenue and maximum-cost comparison
- List of loss-making accounts
- Owner-approved migration schedule
- Customer-notice draft

Do not send notices or migrate subscribers without owner approval.

## 12. Testing

Test:
- Every credit calculation
- Concurrent spending
- Successful capture
- Failed-job refund
- Retry without double charge
- Subscription renewal
- Upgrade/downgrade
- Annual billing
- Credit packs and expiry
- Refunds/disputes
- Replayed/out-of-order Stripe webhooks
- Seat billing
- API/MCP limits
- Plan restrictions
- Competitor-data expiry
- Margin calculation
- Spending limits
- Kill switches
- Existing-customer grandfathering

Run type checking, tests, production build and migration validation.

## 13. Deployment stages

1. Add cost measurement without changing prices.
2. Add the canonical credit engine, ledger and refunds behind feature flags.
3. Configure and test new products in Stripe test mode.
4. Present the proposed Stripe mapping and migration impact for owner approval.
5. Enable new plans for new customers only.
6. Monitor real costs and margins for 30 days.
7. Adjust prices or credit weights based on evidence.

Do not make one uncontrolled production deployment.

## 14. Required output

Create or update:
- PRICING_MODEL.md
- UNIT_ECONOMICS.md
- CREDIT_RULES.md
- STRIPE_PRODUCT_MAPPING.md
- CUSTOMER_MIGRATION.md
- PRICING_DEPLOYMENT_CHECKLIST.md
- OWNER_ACTIONS_REQUIRED.md

Return:
1. Existing problems found
2. Files and database models changed
3. Final pricing configuration
4. Stripe test mapping
5. Cost and margin implementation
6. Tests and results
7. Migration impact
8. Deployment and rollback instructions
9. Remaining risks
10. Owner actions required

Do not state that Clipforge is profitable until production cost and customer-usage data prove it.
