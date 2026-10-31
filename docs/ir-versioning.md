# Universal Skeleton IR lifecycle and schema policy

**Current supported serialized schema: `1.0.0` only.** Package version `0.8.0`, IR schema `1.0.0`, plugin package version `0.8.0` and source format version `4.1.23` are distinct numbers. No version in this list implies support for the others.

IR 1.0.0 is published as `packages/core/src/ir/schema.json`, `types.ts` and the semantic validator in `validate.ts`. The validator checks topology, references, sequences, constraints, capabilities, strict properties, curves and temporal properties. Deserialize only via `deserializeIR` for untrusted JSON; `validateIR` rejects unsupported schema versions with typed `UNSUPPORTED_IR_SCHEMA` (not accidental coercion).

Schema evolution uses SemVer: *major* changes may alter semantic representation; *minor* only adds backward-compatible fields with **documented** defaults; *patch* fixes nonsemantic specification mistakes. A different source format must be handled by a plugin, not by adding source-version checks to the evaluator. Unknown essential capabilities reject with `UNSUPPORTED_SEMANTIC_FEATURE`.

No migration path exists yet. **Do not offer a migration operation that drops data or silently upgrades 1.0.0 to an imagined 1.1.0.** A future migration must be an explicit versioned function with round-trip tests, stable source identity, complete provenance history, and fail-closed cases where an exact mapping cannot be proved. Before changing the IR, confirm compatibility across all currently supported importers, runtime and renderers.

| IR schema | Reader | Migration | Evidence |
|---|---|---|---|
| 1.0.0 | Supported | Identity (no change) | Synthetic tests and G1 structural acceptance on v0.6.0 |
| 1.1.0 / 2.x / unknown | Unsupported | None | Typed rejection |

G2 numerical inheritance/constraints and G3 reference-image equivalence remain UNVERIFIED. A valid IR document means structurally/semantically valid under this implementation's current contracts, **not** certified Spine playback parity.
