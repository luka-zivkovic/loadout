# Validation

Validated locally on 2026-09-09 with Node 22.23.1 and Pi 0.85.1.

## Automated coverage

`npm test`: **9 tests passed**, including real Pi SDK sessions against a local scripted provider. The integration test exports a profile, imports it into a second store, runs it there, and verifies that starting configuration fingerprints match across storage paths with the same provider endpoint. It also executes imported extension code and an extension-defined model provider. A separate real-session test verifies `/share-start`, skill/tool/token collection, `/share-stop`, and that subsequent unmeasured activity does not change the saved record.

Other checks cover credential/session exclusion, content tampering, path traversal, symlinks, executable script permissions, project package overrides, strict metadata validation, duplicate/conflicting imports, unknown costs, failed/successful skill reads, exact committed Git blobs, changed-context rejection, and missing-model failures.

Scripted provider results validate the plumbing; they are not evidence of model quality.

## Live model smoke test

Two seeded review profiles ran against the same small Git fixture using the locally configured `openai-codex/gpt-5.6-terra` model, with medium thinking. The fixture changed a percentage calculation from `price * (1 - percent / 100)` to `price * (1 - percent)`.

| Profile | Status | Turns | Tool calls | Skills observed | Input tokens including cache | Output tokens | Estimated USD | Duration |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | completed | 3 | 5 | 1 | 5,184 | 338 | 0.011659 | 13.6 s |
| callers | completed | 5 | 10 | 1 | 9,639 | 418 | 0.016000 | 20.2 s |

Both reviews identified the percentage normalization defect and the incorrect result for `discount(100, 20)`. Human outcome fields remain unscored. The fixture is too small to judge which setup is better. Costs are Pi usage estimates, not measured subscription charges.

The comparison used profile tool defaults and fresh in-memory sessions. Both runs retained the same frozen input hash:

```text
3acbb921c3a3d6504eb6082b6497986db8ef74454951419f2e3abbba89207833
```

Local artifacts, excluded from Git:

- Comparison: `.demo/live-store/work/comparisons/3171bcae-cd47-4b25-91c4-f5dc6482f00d/report.md`
- Baseline review: `.demo/live-store/work/runs/35db412b-ede2-4281-bb66-77bd251d0390/review.md`
- Callers review: `.demo/live-store/work/runs/fd86e92c-fdc8-47fb-8386-217d6b1789b5/review.md`

The user's current Pi configuration was also captured locally as `makina-current` without copying credentials. The live comparison used the two seeded profiles, not an actual colleague's configuration. Team profile exchange still needs a real colleague's export for that evaluation.
