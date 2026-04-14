# Platform Brief

## One-line pitch

Assessment Platform is a managed local assessment system for AI-assisted coding sessions that scores how a candidate worked, not just what they submitted.

## Why this product matters

Traditional coding assessments are increasingly blind to how modern candidates use AI, browser research, IDE tooling, and copy/paste workflows during problem solving. That makes it hard to separate:

- healthy AI-assisted problem solving
- shallow copy-and-paste assembly
- unmanaged or unsupported tool usage
- candidates who can explain and adapt generated code versus those who cannot

This product addresses that gap by collecting session-scoped telemetry from desktop, IDE, and managed browser surfaces, then turning that evidence into:

- a 51-signal feature vector
- HACI scoring
- archetype prediction
- integrity verdicts
- reviewer/admin triage views

## Core value proposition

The system does not try to ban AI. It measures whether a candidate used AI responsibly, iteratively, and adaptively inside a managed assessment environment.

That makes it useful for:

- hiring assessments where AI use is allowed but must be observable
- post-training or post-onboarding evaluations for new hires
- internal certification checkpoints after a learning cohort or bootcamp
- high-signal human review when simple pass/fail coding tests are no longer enough

## Ideal adopter profiles

### Assessment platforms

Examples: HackerRank, HackerEarth, Unstop, enterprise L&D vendors.

What they gain:

- a differentiated AI-era assessment mode
- richer integrity signals than browser-only proctoring
- session completeness checks before scoring
- reviewer-facing evidence instead of a single opaque score

### Enterprise hiring teams

What they gain:

- a way to test candidates in a managed AI-assisted environment
- better visibility into supported versus unsupported tooling behavior
- cleaner escalation paths for human review

### Enterprise training and enablement teams

What they gain:

- a way to evaluate whether trainees can independently work with AI tools after onboarding
- a more realistic post-training certification flow than static MCQs or take-home tasks

## What makes this different

### It is session-authoritative

The control plane is the source of truth for session state, missing streams, completeness, readiness, and scoring metadata.

### It treats AI use as evidence, not an automatic violation

The product distinguishes between productive AI collaboration and low-integrity dependency patterns.

### It keeps replay regression intact

The replay-fixture path remains a regression baseline so live changes do not destabilize scoring behavior.

### It supports operational triage

Reviewer and admin views can inspect real successful and failed live sessions, including missing streams and invalidation reasons.

### It is grounded in managed runtime surfaces

The current local v1 uses:

- desktop controller orchestration
- VS Code extension telemetry
- session-scoped Edge bootstrap
- analytics recomputation from raw events

## Current product state

The repository currently represents a strong local v1 rather than a full SaaS product.

What is already real:

- replay-fixture regression baseline
- live desktop + IDE managed sessions
- full desktop + IDE + browser sessions
- session-scoped browser bootstrap without `latest_session_id`
- reviewer/admin triage
- 51-signal analytics processing
- integrity and policy recommendation outputs

What still belongs to the SaaS phase:

- authentication and tenancy
- hosted deployment and durable production storage
- webhook/export integrations
- org-level administration
- data retention and compliance controls
- enterprise observability and audit operations

## Suggested first real-world wedge

The fastest commercial wedge is not "replace every coding test." It is:

1. AI-assisted post-training evaluation for newly hired or newly trained engineers.
2. Human-review-first assessment mode for high-value technical screens.
3. Pilot integration with an existing assessment platform that wants AI-era differentiation without replacing its full workflow stack.

## Outcome this product should promise

The promise is not just "catch cheating." The stronger promise is:

"Give reviewers and assessment platforms trustworthy evidence about how a candidate solved the work inside a managed AI-enabled environment."
