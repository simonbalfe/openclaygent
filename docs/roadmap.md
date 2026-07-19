# Roadmap

This document tracks remaining work. Current behavior belongs in `architecture.md`; rationale
and constraints belong in `decisions.md`.

## Shipped foundation

- Per-row actions with templates, typed output, conditional execution, and citations.
- Mastra agent runtime through OpenRouter.
- Search and extraction provider ladders.
- Thin HTTP CLI and validated `POST /run` API.
- CSV batches with bounded concurrency and per-row error isolation.
- LinkedIn and Crunchbase enrichment through optional Apify tools.
- Debug traces covering providers, tools, model calls, tokens, and timing.

## Reliability

- [ ] Add multi-source agreement checks for important claims.
- [ ] Retry transient model and provider failures with backoff.
- [ ] Add configurable confidence thresholds and review queues.
- [ ] Add cache policies for repeat research.
- [ ] Finish token injection and escalation for non-Turnstile challenges.

## Research capabilities

- [ ] Add browsing history and session-based navigation.
- [ ] Add file, image, and document inputs.
- [ ] Add jobs and hiring-signal enrichment.
- [ ] Add G2 and technology-stack enrichment.
- [ ] Add model and provider tiers based on research depth.

## Interfaces

- [ ] Add API authentication before public deployment.
- [ ] Add a hosted deployment path and deployment guide.
- [ ] Add webhook or callback delivery for long-running batches.
- [ ] Add streaming progress for CLI and API clients.

## Scale and operations

- [ ] Add durable job storage and resumable runs.
- [ ] Add rate limits and provider budgets.
- [ ] Add queue-backed workers for large tables.
- [ ] Add production metrics and alerting.
