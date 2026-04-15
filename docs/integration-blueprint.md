# Integration Blueprint

For the latest local validation status, see [Release Status](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/release-status.md).

## Purpose

This document describes how the current local v1 can evolve into an integration-ready product for assessment platforms or internal enterprise evaluation systems.

The goal is to integrate without losing the core product guardrails:

- control plane remains the source of truth
- replay-fixture regression remains intact
- browser capture stays session-scoped
- integrity is evaluated separately from archetype scoring

## Target partners

- assessment platforms such as HackerRank, HackerEarth, and Unstop
- enterprise learning and development systems
- internal hiring platforms with custom reviewer workflows

## Integration model

The most natural integration model is a hosted control plane with a managed local runtime.

Partner system responsibilities:

- create or select the assessment
- identify the candidate
- initiate the managed session launch
- consume scoring outcomes and reviewer links

Assessment Platform responsibilities:

- issue manifests
- create and track sessions
- bootstrap managed clients
- ingest desktop, IDE, and browser telemetry
- compute completeness, integrity, HACI, and archetype outputs
- expose reviewer/admin session detail

## Current local v1 APIs that already map to this model

### Manifest inventory

- `GET /api/manifests`

Used to populate available workflows such as:

- `manifest-python-cli-live-desktop-ide`
- `manifest-python-cli-live-full`

### Session creation

- `POST /api/sessions`

Input today:

- `manifest_id`
- `candidate_id`

This is the natural seam for a future partner-side launch workflow.

### Authoritative session detail

- `GET /api/sessions`
- `GET /api/sessions/:sessionId`

These endpoints already expose:

- status
- required streams
- present streams
- missing streams
- source counts
- integrity verdict
- policy recommendation
- invalidation reasons
- HACI score
- predicted archetype

### Browser bootstrap

- `GET /api/sessions/:sessionId/bootstrap`
- `GET /browser-bootstrap?sessionId=...`

This is the core primitive that keeps managed browser telemetry bound to the correct session.

### Scoring

- `POST /api/sessions/:sessionId/score`
- `GET /api/sessions/:sessionId/scoring`

These endpoints expose the authoritative scoring result and feature vector.

## Observed local behaviors that matter for partner integration

- A session can be fully scored and still carry a `review` verdict if integrity flags are present.
- Browser allowlists matter operationally; unsupported browsing should downgrade policy without preventing raw event capture.
- The latest human-driven full-manifest session proved this by scoring successfully while landing in `review` because it visited unsupported sites and surfaced sequence gaps.
- Third-party AI chat panes inside VS Code may still influence downstream coding behavior without always producing a first-class managed prompt event unless they flow through the assessment extension's own managed AI surface.

## Recommended partner flow

### 1. Candidate starts assessment from partner UI

The partner platform chooses a manifest and launches the managed runtime.

Future production improvement:

- replace raw candidate/session startup with a signed launch token

### 2. Managed local runtime starts

The desktop controller launches:

- the workspace in VS Code
- Edge in an isolated session profile when the manifest requires browser capture

### 3. Telemetry flows into ingestion

The partner does not need to parse raw event streams. It relies on the control plane for session truth.

### 4. Reviewer surfaces update from control plane

Reviewer/admin screens consume authoritative session summaries and detail rather than reconstructing state client-side.

### 5. Partner platform consumes final outcome

The minimum useful payload for a partner integration is:

- session ID
- candidate ID
- manifest ID
- status
- completeness summary
- integrity verdict
- policy recommendation
- HACI score
- predicted archetype
- reviewer deep link

## Recommended future SaaS interfaces

These are the next interfaces to add after local v1, without changing the core scoring architecture.

### Signed launch endpoint

Purpose:

- let a partner create a session launch without trusting local environment variables

Likely shape:

- partner creates a signed session launch request
- desktop controller redeems that token for session bootstrap context

### Result webhook

Purpose:

- push final scoring and integrity outcomes back to the partner system

Suggested payload:

- session summary
- scoring summary
- completeness and invalidation information
- reviewer URL

### Reviewer embed or deep-link contract

Purpose:

- let a partner jump directly into the reviewer for a session or embed a trimmed evidence view

### Export endpoint

Purpose:

- let enterprise customers export scored sessions for auditing or model evaluation

## Guardrails for future integration work

- Do not move browser attribution back to `latest_session_id`.
- Do not make provider prompt/response capture a hard completeness requirement in the first SaaS version.
- Do not redesign the replay-fixture path; keep it as a regression contract.
- Keep control-plane session detail authoritative for readiness and missing-stream logic.

## Gaps between local v1 and partner-ready SaaS

The main remaining work is platformization, not scoring redesign.

### Access and identity

- authentication
- organization and workspace ownership
- reviewer/admin role separation
- tenant isolation

### Runtime trust

- signed launches
- device registration or agent enrollment
- audit logging around session lifecycle actions

### Production persistence

- durable database storage
- migrations
- artifact retention policies
- backup and restore

### Enterprise operations

- monitoring
- alerting
- deployment automation
- support tooling

### Compliance and policy

- retention controls
- PII handling
- legal review for telemetry scope
- enterprise security posture

## Best near-term go-to-market motion

The best early integration pitch is:

1. Keep the partner's existing assessment catalog and candidate workflow.
2. Add one premium managed-AI assessment mode powered by this system.
3. Use human-review-first policy for the first pilots.
4. Expand into post-training evaluation and internal certification once reliability and reviewer trust are established.

## Practical next milestone after local v1

If the local v1 is accepted cleanly, the next highest-value SaaS milestone is:

- single-tenant hosted control plane
- signed launch flow
- result webhook
- one embedded reviewer/deep-link integration path

That would create a credible pilot-ready product without prematurely overbuilding multi-tenant infrastructure.
