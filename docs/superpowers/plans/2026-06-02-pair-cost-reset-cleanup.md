# Pair-Cost Reset Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove legacy trading strategies and leave a small foundation for a new YES/NO pair-cost strategy.

**Architecture:** This is a destructive cleanup, not a new trading implementation. The repo keeps generic infrastructure only: CLOB/Gamma read clients, JSONL logging, Telegram notification, deploy scaffolding, and basic utilities/types. New pair-cost strategy code will be added in a later plan.

**Tech Stack:** TypeScript, Jest, Docker, Node 20.

---

### Task 1: Remove Legacy Active Entrypoints
- [x] Remove scripts for old strategy runners.
- [x] Delete old runner files.

### Task 2: Remove Legacy Strategy Implementations
- [x] Delete legacy strategy files.
- [x] Delete failed spike strategy files.
- [x] Delete old live-runner files.
- [x] Keep generic data/read/log/notify utilities.

### Task 3: Remove Legacy Tests and Docs
- [x] Remove stale tests.
- [x] Keep minimal utility/data tests.
- [x] Remove old strategy docs.

### Task 4: Verify and Commit
- [x] Run `npm run build`.
- [x] Run `npm test -- --runInBand`.
- [x] Confirm no active legacy references remain.
- [ ] Commit and push cleanup branch.
