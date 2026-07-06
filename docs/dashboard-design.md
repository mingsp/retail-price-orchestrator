# Dashboard Design

## Overview

The dashboard should feel like an operations console, not a marketing page.

Primary screen:

- store run progress
- worker status
- account/profile health
- current blockers
- latest risk events

## Main Navigation

- Overview
- Stores
- Runs
- Workers
- Accounts
- Profiles
- Risk Events
- Artifacts
- Exports
- Settings

## Overview Cards

Use compact cards with dense operational data:

- Active runs
- Online workers
- Running tasks
- Manual-required events
- Device-risk workers
- Finished exports

## Worker Table

Columns:

- worker id
- machine label
- OS
- status
- current store
- current account
- current category
- last heartbeat
- last log summary

## Risk Event Table

Columns:

- severity
- event type
- worker
- account
- profile
- store
- category
- observed symptom
- recommended action
- status
- created time

Actions:

- mark handled
- resume task
- reassign task
- retire profile
- mark device risk

## Run Detail

Sections:

- progress by category
- assigned accounts
- raw artifact links
- risk timeline
- export status

## Visual Style

- restrained operational UI
- high information density
- clear status colors
- no decorative hero sections
- no marketing layout

