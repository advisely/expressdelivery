## Summary

<!-- One paragraph: what changed and why. Skip the play-by-play; the diff shows that. -->

## Type of change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Refactor (no behavior change)
- [ ] Security fix
- [ ] Performance improvement
- [ ] Documentation only
- [ ] Build / CI / tooling

## Testing

<!-- How did you verify this works? -->

- [ ] Existing tests pass: `npm run test`
- [ ] New tests added (if applicable)
- [ ] Manually verified in `npm run dev`
- [ ] Built and ran `npm run build:win` (or relevant platform)

## Quality gate

- [ ] `npm run lint` passes with zero warnings
- [ ] `npx tsc --noEmit` passes
- [ ] Semgrep / CodeQL scan reviewed (CI runs both automatically)
- [ ] No new dependencies, OR new dependencies are justified in the description

## Screenshots / clips

<!-- For UI changes, drag-and-drop a screenshot or short Loom/clip here. -->

## Linked issues / specs

<!-- Closes #N or links to docs/superpowers/specs/<spec>.md -->

---

By submitting this PR you confirm:
- The changes follow the security guidelines in `CLAUDE.md`.
- New `catch` blocks log via `logDebug()` or have an inline comment explaining why silence is intentional.
- No secrets (`.env`, API keys, OAuth tokens) are included in the diff.
