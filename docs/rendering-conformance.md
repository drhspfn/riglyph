# Rendering conformance

## Pipeline ownership

Source adapters produce Universal IR. The TypeScript runtime evaluates bones,
constraints, attachment selection, deform and draw order. The shared packet stage
in `renderer-webgl2/src/render/packets.ts` computes world geometry, UVs and clipping
on the CPU. Its name does not imply GPU ownership. JS rasterization, WebGL2 and
Rust consume those same ordered triangles. Rust receives RGP1; this fix does not
change that protocol, importer, serialized IR, atlas UV rules or animation curves.

Selective inheritance was corrected in the shared affine layer. Previously,
polar decomposition applied stretch in the wrong coordinate frame for
`no_rotation_or_reflection`, and used the wrong direction for `no_scale` modes.
Retained stretch now follows the parent world axes; scale-free inheritance follows
the normalized transformed child rotation axis. Translation still uses the full
parent matrix. Serialized mode names and schema remain unchanged. Existing IR
using these modes can therefore produce corrected, visibly different poses.

## Clipping contracts

`strict` remains the default in every API. Both windings and reflections are
valid. Concavity is preserved. Exact collinear vertices lying between their
neighbours can be omitted during triangulation without changing the boundary.
Zero-length edges, repeated vertices, nonadjacent touches, collinear overlaps,
zero-area contours and genuine crossings remain errors. Predicates use an
adaptive exact dyadic orientation fallback instead of fixed world-unit epsilons.
Small positive-area geometry is not discarded by an arbitrary area threshold.

The end slot is inclusive. If the start slot is also the end slot, the scope
continues to the end of draw order. An inactive end slot still closes an existing
scope. Subsequent independent scopes work normally. A new scope encountered
before the previous one ends is explicitly unsupported. Clip state is local to
each packet-generation call, so it cannot leak between frames or seeks.

`compatible` is opt-in. Only contours whose defects are **proper edge crossings**
use a deterministic even-odd fill. Horizontal slabs split at all vertices and
crossings; pairs of sorted boundary edges form disjoint trapezoids. This preserves
both lobes of a bow tie without filling its convex hull, ignoring the mask or
dropping a frame. Other invalid contours still fail. Every fallback emits a
structured warning. A numerically unrepresentable slab also fails explicitly.
Compatibility is a Riglyph policy, **not official parity for malformed input**.
[Spine's clipping guide](https://eu.esotericsoftware.com/spine-clipping#Self-intersection)
states that self-intersecting clipping polygons do not work correctly.

Limits are explicit: 4096 input vertices/intersections, 32768 compatibility
triangles, two million ear containment checks or triangle/clip pair operations
per attachment, and 250000 output triangles per clipped attachment. Existing
surface, total raster triangle, native message and export budgets remain active.
Exceeding a budget reports `LIMIT_EXCEEDED`; fidelity is never silently reduced.

## Public use and diagnostics

```sh
riglyph render scene.ir.json --images textures --clip idle --end 4 --fps 30 \
  --backend native-cpu --clipping-policy compatible --out-dir frames

riglyph render scene.ir.json --images textures --clip idle --out-dir frames \
  --debug-geometry private-geometry.jsonl
```

The diagnostic destination must be new; it is not overwritten even with
`--overwrite`. JSONL records survive a failed render, whereas incomplete staged
frames/video are removed. Records contain source/schema versions, clip, skin,
timestamp, zero-based scheduled frame index, slot/attachment/end slot, draw order,
local weighted vertices, world vertices, winding/area, deform basis/values/length,
influencing bone matrices, defect classes and intersection coordinates.
Diagnostics are capped at 64 MiB and include no texture data. They still contain
private geometry: do not upload reproduction diagnostics to public CI.

```ts
import {WebPlayer, type GeometryDiagnostic} from '@riglyph/player-web';
const player = new WebPlayer({
  canvas,
  geometry: {
    clippingPolicy: 'compatible',
    onGeometryWarning: (warning: GeometryDiagnostic) => console.warn(warning),
  },
});
```

`HeadlessRenderEngine` accepts the same `geometry` options.
`prepareDrawPackets(instance, options)` exposes the policy and diagnostic
callbacks directly. `onGeometryDiagnostic` receives full samples, including valid
ones; warnings are emitted independently. Without a warning callback, the shared
stage writes the structured warning to the console. CLI progress suppression does
not suppress compatibility warnings. The animation-fit prepass and render pass
may each report the same affected sample.

The diagnostic is evidence, not an automatic oracle: a close but disjoint edge
pair is not a crossing; clockwise winding is not invalid winding. Missing deform
(`absent`) differs from an explicit zero deform (`present`). Determining stale
deform, incorrect weighted transforms or lost precision upstream requires
comparison of the recorded local values, deform and six matrix components against
an independent evaluator. Do not label those causes from a polygon exception alone.

## Hiyuki investigation and reference provenance

The private binary probes as Spine **4.1.23**, SHA-256
`da6ded68b77a2658360b53e8e2c43e9e7e4c9922d2461614c4985bf0c207b2d0`.
It has 231 bones, 149 slots, three IK constraints, one default skin and one
four-second animation. Its single 23-vertex clipping attachment is weighted;
each vertex has one influence. The first rejected 30 FPS sample is index 49,
time `49/30`. Fresh instances, sequential evaluation and repeated seeks agree.
The other 119 samples are valid under strict clipping.

Black-box execution of the user-supplied Skeleton Viewer **4.1.24** JAR, SHA-256
`f054adb333616a41c63e0cf4607580f16eb5b82b53d08d6986bbd0d0dfbd1491`, confirmed
the crossing at edges 4/6. Imported local clipping values match exactly. At the
failing sample, deform differs by at most `3.82e-6`, world clipping coordinates
by `3.67e-4`. The crossing already exists in local coordinates plus deform;
it is not introduced by world transforms or Rust. The Java clipper continues
rendering this unsupported contour; its coverage probe produces 21 triangles.
Its behavior is recorded, not adopted as a specification for invalid geometry.

The same comparison independently found an unrelated-to-the-crossing but
reproduction-relevant inheritance defect: animated bone translations differed
by up to 100.39 units. After the affine correction, all six components across
231 bones differ by at most 0.0011 on setup and the selected samples. These are
large world coordinates with float Java arithmetic versus double TS arithmetic.
No reference tolerances or independent golden values were weakened.

The public `inheritance-reference.json` contains **self-authored** synthetic
bones and numerical black-box outputs for all five modes, nonuniform scale,
reflection, shear, child rotation and a collapsed parent axis. It contains no
game data or reference implementation. The old analytic test expecting local-axis
stretch was corrected to the independently observed world-axis result.

Private acceptance at 512×512, nearest sampling, fixed animation-envelope camera:

- JS and native CPU completed all 120 PNG frames; their RGBA bytes match exactly.
- Chromium WebGL2 captured all 120 frames with no console or page errors; maximum
  per-frame mean associated-color error against JS was 0.211/255, alpha 0.077/255.
- Java OpenGL images at one-based frames 1, 48, 49, 50, 51, 60 and 120 were compared
  side by side. Maximum per-image RGB mean absolute error was 0.075/255; alpha
  0.007/255. Individual boundary pixels differ substantially, so these are not
  exact image goldens. No missing limbs/accessories were observed in the inspected
  comparisons and the full 120-frame contact sheet.
- Native export produced complete H.264 MP4 and VP9 WebM: 120 frames, 30 FPS,
  four seconds. WebM alpha was verified by decoding, not just metadata.

Original assets, JAR, private observer/capture harnesses, images and geometry
records stay outside the public repository. Measurements are not a claim of
universal Spine conformance or an official rendering contract for self-crossings.

## Audit and regression map

| Failure class | Finding and action | Coverage |
| --- | --- | --- |
| `INVALID_TOPOLOGY`, Hiyuki mask | Genuine source deform crossing; strict retained, explicit even-odd policy added | Synthetic crossing/deform/seek tests; private Java observations |
| Valid tiny/large contours | Absolute epsilon rejected or dropped real area; adaptive predicates and boundary-preserving triangulation | Geometry conformance scales `1e-12`–`1e15`, reversed and collinear contours |
| Nonadjacent edge touches/overlap | Previous strict check missed non-endpoint touches; now classified and rejected | Touch, overlap, repeat and zero-area regressions |
| Selective transform inheritance | Valid animated poses differed from reference; fixed shared affine operation | 70 synthetic child configurations plus A19/A20 suites |
| Clipping lifecycle | Sequential/inclusive scopes valid; true overlap remains unsupported | Lifecycle, attachment switch, draw-order change, reflection and repeated calls |
| `INVALID_ATTACHMENT`, linked meshes | Cycles, missing/non-mesh parents correctly rejected; geometry/deform ownership retained | Existing IR/runtime/linked-mesh and atlas suites |
| `INVALID_TIMELINE`, deformation | Invalid sparse bounds and lengths remain errors; influence cursor and reset unchanged | Existing deform/constraint suites plus weighted animated clipping |
| `UNSUPPORTED_SEMANTIC_FEATURE` | Overlap, unavailable sequence frames, absent WebGL/native resources remain explicit errors | Existing capability, browser and native tests |
| Native topology/packet size | Rust is downstream; RGP1 unchanged, malformed arrays and RGBA sizes stay errors | Native protocol and JS/Rust pixel parity, dynamic sequence |
| `LIMIT_EXCEEDED` | Bounded geometry expansion added; existing input/surface/message/export budgets preserved | Polygon limits and existing headless/native budget tests |
| Export failure cleanup | Strict failure preserves diagnostic but never commits partial frames as success | CLI geometry regression and headless video integration |

This table distinguishes static review of existing rejection paths from new
reproduced defects. It does not certify every possible malformed input or every
unsupported source feature. Singular inverse transforms and features explicitly
excluded by capability inspection retain their existing limitations.

## Verification

Run `npm run build`, `npm run typecheck`, `npm test`, Rust workspace tests and
`node --test dist/tests/native-*.spec.js` with `RIGLYPH_NATIVE_BIN` set. Run
`scripts/browser-geometry.py`, existing WebGL tests and React/Next production
smoke. Geometry browser tests inspect all synthetic output frames, with failure
screenshots and diagnostics containing only self-authored data. CI covers Node
22/24 on Linux/Windows, native platforms and actual Chromium integration.
Private Hiyuki verification supplements public synthetic CI; private assets
must never be required by a public test.

## Measured costs

One local Windows/Node 24 run, 120 frames at 512×512, four Rust threads,
nearest sampling, PNG compression 6. A private observer timed the same packet
implementation and asserted its output equal to the canonical implementation;
Rust's existing raster counter was observed without changing RGP1.

| Stage | Mean ms/frame | Maximum ms/frame |
| --- | ---: | ---: |
| Animation/constraints | 1.28 | 5.11 |
| Mesh/clipping world vertices | 0.76 | 2.62 |
| Mask decomposition | 0.09 | 1.47 |
| Triangle clipping | 0.55 | 6.03 |
| Other packet work (including region vertices/UVs/allocation) | 3.96 | 10.61 |
| Native request serialization | 0.83 | 5.67 |
| Native transport/protocol residual | 3.34 | 35.26 |
| Rust rasterization | 10.21 | 12.00 |
| JS rasterization | 69.09 | 258.60 |
| PNG encoding | 10.67 | 11.88 |

Transport residual is round-trip time minus serialization and the Rust counter;
it includes process scheduling, protocol decoding and initial texture upload,
not just wire transfer. H.264 encoding of the prepared 120 RGBA frames took
713 ms including process startup and output verification. The mask has 23
vertices; compatibility decomposition has 94 triangles at the failing sample;
the largest full-scene packet set has 5797 triangles.

An alternating, warmed packet-only comparison on the 119 valid poses (1190
samples per implementation) measured median 1.889 ms before and 1.966 ms after,
about 4.1% extra packet cost for strict robustness. The invalid sample is excluded
from this comparison because the old implementation throws. These are local
measurements, not CI performance thresholds. The supplied 209-second log lacks
matched resolution/backend parameters, so no speedup against that log is claimed.
