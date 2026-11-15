---
status: accepted
---

# Providers own their Valuables through Grants

Providers need their own Game assets in the game, but downloads are for Owners only. Instead of an access-rule exception for Providers, the server gives the user linked to a Valuable's Provider a **Grant** when the Valuable's Scan first goes live: a UserValuable marked `granted` (price 0, Completed, no payment method). Ownership stays the single rule for Game asset links; only admins get a bypass, on the link endpoint alone. Decided in [#21](https://github.com/Bene97Kiel/vimu_payload/issues/21). The term is defined in `GLOSSARY.md`.

## Consequences

- UserValuable records how it came about (`acquired` or `granted`), and `paymentMethod` becomes optional for grants.
- A Grant appears in the Provider's Vault in the collector app like any other UserValuable.
- Anything that counts collectors, sales or payouts must leave Grants out.
- A Grant is created only once per user and Valuable, and an admin can delete it.
