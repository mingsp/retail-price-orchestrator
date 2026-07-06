# Product Brief

## Product Goal

Build a durable orchestration system for authorized multi-device retail price collection.

The immediate operating model is three devices:

- `xf`: master + worker
- `mm`: worker
- `jl`: worker

The long-term model is many devices, accounts, and stores.

## Users

| User | Need |
|---|---|
| Operations lead | See collection progress and assign stores/accounts |
| Worker operator | Handle login, captcha, identity checks, and local browser issues |
| Data analyst | Receive clean business CSV/Excel exports |
| Engineer | Debug worker, task, profile, and data issues |

## Key Workflows

1. Register worker devices.
2. Register accounts and browser profiles.
3. Create store collection runs.
4. Generate or upload store category plans.
5. Assign category tasks to accounts/workers.
6. Monitor progress and worker heartbeat.
7. Pause on captcha, account block, or device/IP risk.
8. Notify humans for manual handling.
9. Resume or reassign tasks.
10. Archive raw data.
11. Export business-format data.

## UX Principles

- Status first: each screen should answer what is running, blocked, done, or unsafe.
- Risk visibility: captcha, blocked account, profile risk, and device risk must be obvious.
- Operator actionability: every blocked state should show the exact device, account, profile, store, category, and suggested next action.
- Raw-first data: never hide the raw artifact path behind a dashboard-only abstraction.
- No secrets in UI logs: accounts use aliases, not phone numbers or credentials.

