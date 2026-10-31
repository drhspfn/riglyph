# Compatibility matrix

| Capability | Status |
|---|---|
| Source recognition | Spine **Binary 4.1.23** exact only |
| G1 v0.14.0 | 5/5 independent private validation (per A16 handoff) |
| G1 v0.15.1 | NOT RECHECKED; independent verifier required |
| Universal IR 1.0.0 | Own structural/semantic validation |
| G9/G10 playback and mixing | Own synthetic regression coverage |
| Clipping self-end / trimmed mesh UV | Own regression coverage |
| G3 CPU/WebGL2 | Own synthetic parity tests only |
| G2 official numerical | UNVERIFIED_NO_REFERENCE |
| G3 official visual | UNVERIFIED_NO_REFERENCE |
| JSON / `.spine` / other Spine versions | UNSUPPORTED |
| Legal/provenance | OWNER REVIEW REQUIRED |

Unsupported active features must be diagnostic failures; no silent fallback to successful import or full compatibility claim.

## A18 atlas quarter-turn correction (v0.15.1)

Observed and independently verified atlas UV orientation in a Spine 4.1.24 Viewer against a 4.1.23 binary: 90° uses `(v, 1-u)`, 270° uses `(1-v,u)`; the shared renderer's atlas mapper now follows this contract. No IR or decoder changes. Full G2/G3 parity is **not** inferred. This patch requires independent G1/G3 replay before public release.
