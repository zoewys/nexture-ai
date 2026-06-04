# Handoff JSON Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render each workflow agent's parsed handoff JSON as a stable structured panel instead of a plain summary list.

**Architecture:** Keep the main-process handoff parsing unchanged. Add a renderer-side display-model formatter for `HandoffArtifact`, then update `HandoffPanel` to render summary, artifacts, and next-step guidance from that model.

**Tech Stack:** Electron, React, TypeScript, Node built-in test runner.

---

### Task 1: Handoff Display Formatter

**Files:**
- Create: `src/renderer/src/handoffDisplay.ts`
- Create: `test/handoffDisplay.test.mjs`
- Modify: `package.json`

- [x] **Step 1: Write failing tests** for label defaults, artifact rows, and optional guidance.
- [x] **Step 2: Run tests and confirm they fail** because `handoffDisplay.ts` does not exist.
- [x] **Step 3: Implement `formatHandoffDisplay(handoff)`** as a pure formatter.
- [x] **Step 4: Run tests and confirm they pass.**

### Task 2: Structured Handoff Panel

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

- [x] **Step 1: Update `HandoffPanel`** to call `formatHandoffDisplay`.
- [x] **Step 2: Render fixed sections:** `Summary`, `Artifacts`, and optional `Next Step Guidance`.
- [x] **Step 3: Add table and empty-state styling.**
- [x] **Step 4: Run formatter tests and `pnpm typecheck`.**

### Task 3: Verification

**Files:**
- Verify only.

- [x] **Step 1: Run `pnpm test`.**
- [x] **Step 2: Run `pnpm typecheck`.**
- [x] **Step 3: Run `pnpm build`.**
- [x] **Step 4: Inspect `git diff --check` and `git status --short`.**
