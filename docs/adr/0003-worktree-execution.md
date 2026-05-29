# ADR 0003: Worktree Execution

Status: Proposed
Date: 2026-05-29

## Context

The current tool runtime can apply patches inside `TARGET_PROJECT` with policy
checks. That is acceptable for a local prototype, but it is not the right
default for a trustworthy self-improving control plane.

Self-targeting becomes unsafe when the worker edits the checkout that contains
its own active source and process.

## Decision

All autonomous mutation attempts should execute inside an isolated attempt
workspace, preferably a git worktree.

The target flow is:

1. Create or reset an attempt workspace.
2. Bind the workspace ID to the attempt.
3. Run patch dry-run inside the workspace.
4. Apply approved low-risk patch inside the workspace.
5. Run verification inside the workspace.
6. Store patch and verification evidence against the workspace.
7. Export a patch bundle or submit to promotion.

Direct mutation of the active project root is not the Blueprint v2 target path
for autonomous work.

## Consequences

- The active worker checkout remains clean during attempts.
- Patch evidence and verification evidence can point to the same workspace.
- Workspace lifecycle and cleanup become explicit policy decisions.
- Tests need fixtures for workspace creation, patch application, verification,
  cleanup, and archive behavior.

## Follow-Up

- Add a D4 workspace manager.
- Bind patch bundle export to workspace evidence.
- Add path-boundary tests for workspace-local mutation.
