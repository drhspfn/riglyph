# A20 Path reference diagnostics — 2026-11-01

## Scope / reproducibility

Branch `feat/spine41-ik-path-completion`; last evaluated commit `ffe962581d488d28222f73d756ff6495cd653aa4`.
GitHub Actions run: https://github.com/drhspfn/riglyph/actions/runs/41334384664

The repository's immutable independent A19/A20 numeric oracle data are retained.
On Ubuntu and Windows, Node 22 and 24: **408 of 413 tests pass**; remaining failures
are A19 Path 77, 78, 93, 94 and A20-PATH-06. Browser and frameworks pass.
IK independent reference observations all pass (57/57); Path passes 204/209.
All six world affine components are asserted. Default absolute tolerance is 1e-4.

## A19 Path 77, 78, 93, 94

All four are closed, constant-speed, `spacingMode=proportional`,
`positionMode=fixed`, two constrained bones, `spacing=10`, `position=12`.
77/78 use `chain`; 93/94 use `chainScale`; each weighted/unweighted variant
fails only second bone orientation/scale. The world XY position agrees with reference
within the accepted tolerance.

| Case | Maximum absolute error |
|---|---:|
| A19 Path 77 | 0.00028742994959501944 |
| A19 Path 78 | 0.0003644346316318825 |
| A19 Path 93 | 0.005636459943198613 |
| A19 Path 94 | 0.006698152083959297 |

Independent inverse sampling (using the existing four-chord length and ten-chord
sample approximation) estimates that the last *virtual* sampling distance would
need to change by roughly -0.203 (unweighted) or -0.242 (weighted) to reproduce
the reference chord direction, although the second bone's own sampled position
already matches. **This is a diagnostic inversion, not a proposed correction.**
Do not introduce case-conditioned epsilon offsets or relax tolerances.

## A20-PATH-06

This is a three-bone, unweighted, closed, constant-speed, tangent-mode path with
`root.scaleX=-1.2`, `position=-14`, `spacing=-8`, fixed/fixed modes,
`offsetRotation=15`, independent mixes `(rotate=0.7, X=0.8, Y=0.5)`.

The first bone agrees with the independent reference; the later bones do not:

| Bone / component | Expected | Actual from run #41 |
|---|---:|---:|
| two.worldX | -5.56446075 | -4.816519013934169 |
| two.worldY | -9.14163208 | -9.077208876113513 |
| three.worldX | -22.31490898 | -18.642615016646417 |
| three.worldY | -10.92816353 | -10.611731162836776 |

Using the unmodified mixed-affine baselines to invert XY mixing, the expected
reference path targets are approximately `two=(-1.40709,-11.60654)`,
`three=(-15.01570,-13.48682)`; current targets are approximately
`two=(-0.47216,-11.47769)`, `three=(-10.4253,-12.85392)`.
This implicates **spacing accumulation / sample-distance semantics** under
reflection, negative fixed spacing and three constrained bones; it is not only
an offset-rotation or output-matrix issue.

A separate experiment with simulated float32 control vertices, tables and
spacing accumulation did not reproduce the discrepancy. Float32 rounding alone
does not establish parity, nor justify loosening acceptance.

## Guardrails and remaining work

- Match reference on full six-component matrices; never rewrite goldens.
- Diagnose geometric distances and the last virtual sample independently from
  rotation/mixing, especially when `distance >> closed path length`.
- Validate non-reflected cases, both weighted states, open/closed,
  multiple curves and repeated seek after *every* numeric change.
- Preserve zero-offset chain-tip semantics and its new synthetic tests.
- Keep PR in Draft and `sourceParity` unverified until all 209 Path and 57 IK
  independent oracles pass and the six CI jobs are green on the final commit.

This document reports observations and hypotheses only; the five numerical
regressions remain blocking.
