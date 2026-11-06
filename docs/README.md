# BASERA documentation map

This folder contains the project guide, current technical contracts, evidence, release procedures, and historical design notes. Start here before reading individual documents.

## Start here

1. [Project overview](PROJECT_OVERVIEW.md) — what BASERA is, its components, architecture, data flows, and current boundaries.
2. [Feature status](FEATURE_STATUS.md) — what exists and whether it is unit-tested, host-verified, device-tested, or still planned.
3. [Architecture](ARCHITECTURE.md) — how the mobile app and supporting services fit together.
4. [AI inspection guide](AI_INSPECTION_GUIDE.md) — rules for an AI agent or teammate inspecting this repository.
5. [Team presentation guide](TEAM_PRESENTATION_GUIDE.md) — suggested presentation structure and a 10-person speaking split.
6. [Testing record](../TESTING.md) — dated historical test evidence. Re-run the commands for the current commit before quoting a result.

## Current technical references

| Document | Use it for |
|---|---|
| [Models](MODELS.md) | Model names, formats, provenance, hashes, licences, and model limitations |
| [Supabase integration](SUPABASE_INTEGRATION.md) | Current deployed Guardian backend contract |
| [Supabase repository rules](../supabase/README.md) | Migration safety, source-of-truth policy, and production approval rules |
| [Edge Functions](../supabase/functions/README.md) | Deployed Guardian Edge Function behaviour and what is not deployed |
| [Guardian PWA](../guardian-pwa/README.md) | Companion web application and its actual capabilities |
| [Telemetry](TELEMETRY.md) | Telemetry architecture, historical verification, and deployment caveats |
| [Guardian setup](GUARDIAN_SETUP.md) | Current status and safe remaining setup work |
| [Smart glasses integration](GLASSES_INTEGRATION.md) | Future hardware interface; not a claim that glasses exist |
| [Release runbook](RELEASE.md) | APK/OTA rules, channels, acceptance, and rollback |
| [Branding](BRANDING.md) | Visual identity and language |
| [Copy](COPY.md) | Approved product language |
 
## Reading old plans and reports safely

Documents such as V1.1_PLAN, QUALITY_OVERHAUL, POLISH, REDESIGN, OTA_AUDIT, BUGFIX_RELEASE, SECURITY_REMEDIATION, and version-specific UI notes preserve decisions and historical work. They are useful for understanding how the project evolved, but they are not automatically the current implementation contract.

When documents disagree, use this order:

1. Current source code on the branch being inspected.
2. Current deployed-contract documents, especially SUPABASE_INTEGRATION.md and supabase/README.md.
3. FEATURE_STATUS.md and PROJECT_OVERVIEW.md for the current summary.
4. TESTING.md and dated test reports for the exact evidence and date they record.
5. Historical plans only for context.

Never execute an old migration or deployment checklist merely because it remains in a historical document.