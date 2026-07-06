# Agent Model

## Are We Building a Multi-Agent System?

Yes, operationally this is a multi-agent system, but not because multiple LLMs chat with each other.

The useful definition here:

- master scheduler agent: decides task assignment and state transitions
- worker execution agents: run local browser/CDP tasks
- Codex operator agents: assist humans and repair local issues
- human agents: handle login, captcha, identity checks, and account decisions

## Boundary

The system should not rely on one Codex session directly controlling another Codex session.

Instead:

- master stores durable state
- worker agents execute deterministic local tasks
- Codex assists on each machine when judgment or repair is needed
- humans handle authorization and verification

This makes the system scalable and recoverable.

