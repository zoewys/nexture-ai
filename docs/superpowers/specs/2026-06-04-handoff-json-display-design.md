# Handoff JSON Display Design

## Goal

When a workflow step finishes, Agent Studio should parse the agent's handoff JSON and present it in a stable, readable format for every selected agent step.

## Confirmed Display Format

The UI renders the parsed `HandoffArtifact` object as:

- `Summary`: the handoff `summary` text.
- `Artifacts`: a table with `type`, `path`, and `description`.
- `Next Step Guidance`: the optional `nextStepGuidance` text when present.

The display should not rely on showing raw JSON as the primary experience. Raw transcript output may still exist in the agent transcript, but the workflow handoff panel is the structured review surface.

## Architecture

The main process already parses the final assistant message into `WorkflowStepExecution.handoff`. The renderer should keep using that parsed object and avoid reparsing transcript text. A small renderer-side formatter converts `HandoffArtifact` into a display model with stable labels and fallback behavior, and `HandoffPanel` renders that model.

## Scope

In scope:

- Add a reusable handoff display formatter.
- Add tests for formatter behavior.
- Update the workflow handoff panel to render structured sections and artifact rows.
- Add CSS for the structured handoff panel.

Out of scope:

- Changing the handoff JSON schema.
- Changing prompts sent to agents.
- Persisting separate raw JSON fields.
- Reworking transcript rendering.

## Verification

Run the formatter tests, full TypeScript typecheck, and a production build. Browser-level visual validation should confirm the panel renders the structured format without layout overflow.
