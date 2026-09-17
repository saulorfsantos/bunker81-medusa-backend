# Card 152 sandbox lineage reconciliation

Card 152 starts from `5c772d0165474a76a242adb1e5bde84349021d48`.
The divergent lineage was inspected commit by commit and was not merged or
cherry-picked.

| Commit | Classification | Card 152 decision |
| --- | --- | --- |
| `fc37abc` | A/D: fail-closed local sandbox infrastructure and local fixture tooling | Excluded; it is not required by the production backend artifact. |
| `8ac542b` | B: payment-session ownership hardening | Excluded as already equivalent: its two changed files are byte-identical to `81a6ee2`, an ancestor of `5c772d0`. |
| `919f0d1` | A/D plus payment-service sandbox branches | Excluded; loopback runtime, local fixture, and local credential behavior are sandbox-only and not required for production readiness. |
| `0e4d1d1` | A plus sandbox-specific payment semantics | Excluded; local card refresh/reconciliation and conditional notification behavior are not needed by the production artifact and would alter payment semantics after the selected hardening base. |
| `ec0e8ad` | A/D: local runtime fixture and sandbox test corrections | Excluded; local-only and not a production prerequisite. |
| `8262ca2` | D: Docker host-port compatibility and harness documentation/tests | Excluded; local tooling only. |

No class-A delta was both necessary for the production backend and independent
of payment semantics. Therefore Card 152 incorporates none of this divergent
lineage. The existing `5c772d0` payment implementation remains the semantic
baseline; Card 152 adds only the existing-region provider backfill, its tests,
and the production execution documentation/configuration.
