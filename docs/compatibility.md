# Compatibility matrix

| Capability | Status |
|---|---|
| Source recognition | Spine **Binary 4.1.23** exact only |
| G1 v0.14.0 | 5/5 independent private validation (per A16 handoff) |
| G1 v0.15.1 | NOT RECHECKED; independent verifier required |
| Universal IR 1.0.0 | Own structural/semantic validation |
| G9/G10 playback and mixing | Own synthetic regression coverage |
| A19/A20 IK Constraint world-affine references | **57/57** independent synthetic numeric cases (40 A19 + 17 A20) |
| A19/A20 Path Constraint world-affine references | **209/209** independent synthetic numeric cases (192 A19 + 17 A20); includes reflected negative spacing and repeated wraps |
| A20 constraints and deform pipeline | Path vertex deformation, weighted geometry, sequential curve traversal and mixed constraint-order synthetic regression coverage |
| Scope of numeric oracle | Compiled Spine Viewer **4.1.24** reference, importer profile **Binary 4.1.23**; six world-affine components, default absolute tolerance **1e-4** (documented large-translation float32 ULP budget) |
| Clipping self-end / trimmed mesh UV | Own regression coverage |
| G3 CPU/WebGL2 | Own synthetic parity tests only |
| G2 official numerical | UNVERIFIED_NO_REFERENCE |
| G3 official visual | UNVERIFIED_NO_REFERENCE |
| JSON / `.spine` / other Spine versions | UNSUPPORTED |
| Legal/provenance | OWNER REVIEW REQUIRED |

Unsupported active features must be diagnostic failures; no silent fallback to successful import or full compatibility claim.

## A18 atlas quarter-turn correction (v0.15.1)

Observed and independently verified atlas UV orientation in a Spine 4.1.24 Viewer against a 4.1.23 binary: 90° uses `(v, 1-u)`, 270° uses `(1-v,u)`; the shared renderer's atlas mapper now follows this contract. No IR or decoder changes. Full G2/G3 parity is **not** inferred. This patch requires independent G1/G3 replay before public release.

## A20 IK + Path acceptance matrix (November 2026)

The independent numeric fixtures cover 266 IK/Path cases: 57 IK and 209 Path.
They exercise the source-version-neutral runtime with synthetic Universal IR, not
an embedded upstream animation runtime. Path verification includes one- and
multi-curve traversal, negative spacings, reflection, path vertex deformation,
and the 192-case mode matrix. The four A19 closed/proportional wrap mismatches
and A20 reflected negative-spacing mismatch were fixed by preserving the
forward-only 10-interval Bézier lookup cursor **within each curve** while
sampling a constraint's ordered positions; independent `sample()` remains
stateless. Reference results, tolerance limits and expected affine values were
not rewritten to make the suite pass.

**Limits:** This is profile-specific *partial numerical reference coverage*, not
a claim that every possible third-party animation, G2 full numerical parity or
G3 visual pixel parity has been checked. Check GitHub Actions on the final PR
HEAD for browser, Node 22/24, Linux/Windows and React/Next.js results. No
additional source versions are implied.

## A20 code-review edge validation

The PR includes focused **self-authored regression tests** beyond the 266 independent
reference observations. In `tests/a20-review-ik-edge.test.ts`, softened-goal
selection is checked when the target lies within the ordinary reach boundary,
while the reference's outer unreachable fallback remains unchanged. The
zero-X/nonzero-Y child offset is exercised with shear, negative determinants,
nonuniform parents and partial mixes, comparing all six world-affine components
and repeatability. The zero-X/zero-Y reference observation remains unchanged.

`tests/a20-review-path-epsilon.test.ts` checks both sides of the 1e-8 chord
threshold for positive/negative spacing, open/closed paths, mirrored and normal
transforms, and `chain`/`chainScale` modes. These boundary tests are not
additional Viewer-oracle observations and do not enlarge the claimed independent
reference corpus.

### What capability reporting means

- `fullyEvaluable` is **only a runtime Universal IR executability result** for
  the active skin and requested animation clips, not a certification of binary
  import fidelity or compatibility with every Spine asset.
- `sourceParity='NUMERIC_REFERENCE_PARTIAL'` means a relevant active runtime
  constraint has **bounded synthetic independent numerical evidence**. It does
  **not** mean full source-format or visual parity. A report without such a
  verified active constraint uses `UNVERIFIED_NO_REFERENCE`.
- `fullSourceParityVerified` is explicitly `false`; the
  `referenceScope` is `BOUNDED_SYNTHETIC_CASES` even if
  `fullyEvaluable=true`. An active unsupported feature remains reported in
  `unsupported` and forces `fullyEvaluable=false`.


## A21 headless rendering profile

| Output | Support | Verification |
|---|---|---|
| PNG sequence RGBA | Browser-free CPU | independent frame writes, PNG decoder and manifest regression |
| MP4/H.264 YUV420P | Optional FFmpeg libx264 | actual ffprobe codec/FPS/frame count/duration, decoded sample frame in CI |
| WebM/VP9 alpha | Optional FFmpeg libvpx-vp9 | alpha metadata plus libvpx decoder RGBA sample check in CI |
| Camera | fit-scene, fit-selection, fixed, follow | deterministic synthetic tests; stable animation sampled prepass |
| Runtime features | Universal IR, IK, Path, deform, clipping, tint/blending | reuses existing runtime/CPU rendering; previous test suite retained |

This does **not** extend the recognized input format beyond Spine Binary 4.1.23.
A fit-scene animation camera envelope samples requested output frames; it is
not an exact continuous-time extremum. WebM alpha requires compatible players
and decoders. FFmpeg is not bundled and no audio is muxed. Video requires even
dimensions for 4:2:0 conversion.


## A22 Rust Native Rasterizer

Optional feature: Rust native CPU rasterization from versioned RGP1 v1
canonical draw packets. The TypeScript Universal IR parser, animation evaluator,
IK and Path remain authoritative. Supported prebuilt matrix: Windows x64,
Linux x64, macOS ARM64, with C ABI v1 and native implementation v0.1.0.
New binary/profile formats are not implied. The prior JS renderer is available
and forms the pixel-diff regression baseline; this is not an additional
Spine source-format compatibility claim.

The native shared library alone cannot animate arbitrary Universal IR or
source-format skeleton files. Its C/Python clients provide pre-evaluated
packet inputs. No proprietary source-runtime code is embedded.

### Native atlas-size regression (A22)

4096×4096 RGBA8 atlas pages are supported independently of the maximum 8,388,608-pixel **render framebuffer**. Per-page limit: 8192 per side and 33,554,432 pixels; total cache: 512 MiB. Native CI checks a full-size 4096×4096 binary upload, reuse across renders, and pixel agreement with the existing JS rasterizer.
