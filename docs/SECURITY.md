# Security

- Validate all inputs.
- Limit upload size.
- Sanitize filenames.
- Parameterized SQL.
- JWT ready.
- Environment variables.
- Secure file handling.

Prototype excludes MFA and enterprise security features.

## Auth/JWT scope decision

Authentication is out of scope for this prototype: it's a single-user, local-first tool meant to run entirely on one machine for learning/demonstration (per `CLAUDE.md`), with no multi-tenant or remote-access use case driving a login flow. No routes currently require auth, and none should be added.

"JWT ready" above means the architecture shouldn't be *designed against* adding auth later (per `CLAUDE.md`'s "design so cloud migration is possible later") — e.g., a future `user_id` column or JWT middleware should be addable without a rewrite — not that JWT is implemented or partially built now.