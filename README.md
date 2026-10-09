<p align="center">
  <a href="https://www.medusajs.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://user-images.githubusercontent.com/59018053/229103275-b5e482bb-4601-46e6-8142-244f531cebdb.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://user-images.githubusercontent.com/59018053/229103726-e5b529a3-9b3f-4970-8a1f-c6af37f087bf.svg">
    <img alt="Medusa logo" src="https://user-images.githubusercontent.com/59018053/229103726-e5b529a3-9b3f-4970-8a1f-c6af37f087bf.svg">
    </picture>
  </a>
</p>
<h1 align="center">
  Medusa
</h1>

<h4 align="center">
  <a href="https://docs.medusajs.com">Documentation</a> |
  <a href="https://www.medusajs.com">Website</a>
</h4>

<p align="center">
  Building blocks for digital commerce
</p>
<p align="center">
  <a href="https://github.com/medusajs/medusa/blob/master/CONTRIBUTING.md">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat" alt="PRs welcome!" />
  </a>
    <a href="https://www.producthunt.com/posts/medusa"><img src="https://img.shields.io/badge/Product%20Hunt-%231%20Product%20of%20the%20Day-%23DA552E" alt="Product Hunt"></a>
  <a href="https://discord.gg/xpCwq3Kfn8">
    <img src="https://img.shields.io/badge/chat-on%20discord-7289DA.svg" alt="Discord Chat" />
  </a>
  <a href="https://twitter.com/intent/follow?screen_name=medusajs">
    <img src="https://img.shields.io/twitter/follow/medusajs.svg?label=Follow%20@medusajs" alt="Follow @medusajs" />
  </a>
</p>

## Compatibility

This starter is compatible with versions >= 2 of `@medusajs/medusa`. 

## Getting Started

Visit the [Quickstart Guide](https://docs.medusajs.com/learn/installation) to set up a server.

Visit the [Docs](https://docs.medusajs.com/learn/installation#get-started) to learn more about our system requirements.

## What is Medusa

Medusa is a set of commerce modules and tools that allow you to build rich, reliable, and performant commerce applications without reinventing core commerce logic. The modules can be customized and used to build advanced ecommerce stores, marketplaces, or any product that needs foundational commerce primitives. All modules are open-source and freely available on npm.

Learn more about [Medusa’s architecture](https://docs.medusajs.com/learn/introduction/architecture) and [commerce modules](https://docs.medusajs.com/learn/fundamentals/modules/commerce-modules) in the Docs.

## Customer account security

The storefront customer area relies on Medusa's customer bearer/session authentication. A middleware
on `GET /store/orders/:id` requires an authenticated customer and verifies that the order's
`customer_id` matches the authenticated actor. Guest checkout remains available; the storefront uses
the order returned by cart completion for the immediate guest confirmation instead of reopening this
protected route.

Customer password reset uses Medusa's temporary, single-use reset token and the local Resend
notification provider. Configure these together in the backend deployment secret/config store:

```bash
STOREFRONT_URL=https://your-storefront.example
RESEND_API_KEY=
RESEND_FROM="Bunker 81 <loja@bunker81.com.br>"
# Optional: defaults to the mailbox in RESEND_FROM.
RESEND_REPLY_TO=loja@bunker81.com.br
```

`STOREFRONT_URL` must be the public HTTPS origin of the storefront, without a path/query/fragment.
HTTP localhost is accepted only outside production. The provider is enabled when Resend credentials
are supplied; partial configuration fails startup. `STOREFRONT_URL` alone does not enable email.
No SendGrid account, SendGrid environment variables, external template, or extra npm package is
required. The Portuguese HTML/plain-text reset message is versioned in `src/modules/resend/service.ts`.
The provider uses the Resend HTTPS API with a bounded timeout, sanitized failures and a stable
idempotency key per reset. It rejects reset links outside the configured storefront and mismatched
recipients. It does not change token issuance/expiry, authentication, order ownership or checkout.

Keep the domain's inbound MX at Lark; only add the sending records supplied by Resend and keep
receiving disabled there. Both the visible sender and replies use the store mailbox. Automated
messages are not automatically added to Lark's Sent folder. Keep click/open tracking disabled on
password-reset mail. Never expose the API key or log reset links/tokens. Use a sending-only API key
restricted to the Bunker domain. Dashboard notifications/history must not expose live reset links.

### Card 152 production activation

Saulo selected a direct production rollout with manual EasyPanel operation, rather than provisioning
staging. Adding environment variables does not deploy this branch. Before publishing:

1. Confirm the storefront's actual public origin; set `STOREFRONT_URL`, `STORE_CORS` and `AUTH_CORS`
   accordingly. Confirm Resend domain verification and backend-only credentials.
2. Record current frontend/backend releases and take a database backup/snapshot before restart:
   the existing start command runs `npm run db:migrate && npm run mp:backfill-region && npm start`.
   This Resend change introduces no migration; existing runtime migration state is not proven here.
   Reverting code does not reverse a database migration.
3. Publish compatible backend/storefront versions (backend PR #6 and storefront PR #14); test
   signup/login/logout, real email reset with expired/reused token rejection and old-password
   rejection, own orders and denial to another customer/visitor, guest/authenticated checkout.
4. On a concrete failure, correct it or restore the recorded compatible releases. Restore the
   database only if required by the actual migration/change, using the snapshot and recovery plan.

Local checks do not establish runtime delivery or successful account flows. Payment/shipping release
validation belongs to card #93 after the account delivery. Menoh Mail/mailcow is post-release (#153).

## Community & Contributions

The community and core team are available in [GitHub Discussions](https://github.com/medusajs/medusa/discussions), where you can ask for support, discuss roadmap, and share ideas.

Join our [Discord server](https://discord.com/invite/medusajs) to meet other community members.

## Other channels

- [GitHub Issues](https://github.com/medusajs/medusa/issues)
- [Twitter](https://twitter.com/medusajs)
- [LinkedIn](https://www.linkedin.com/company/medusajs)
- [Medusa Blog](https://medusajs.com/blog/)


