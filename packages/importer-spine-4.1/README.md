# @riglyph/importer-spine-4.1

Build-time import adapter for Spine Binary 4.1.23 into Riglyph IR.

**Version:** 0.16.3 (pre-1.0 preview). Part of the [Riglyph toolkit](https://github.com/drhspfn/riglyph).

## Installation

```sh
npm install @riglyph/importer-spine-4.1
```

Install only after the corresponding npm package is published. Local checkout builds use `npm run build` and `npm run pack:check`; packages are released together at the same version.

## Documentation

See [Riglyph documentation](https://github.com/drhspfn/riglyph/blob/main/docs/compatibility.md) and the [getting started guide](https://github.com/drhspfn/riglyph/blob/main/docs/getting-started.md).

Riglyph is an independent project. The current import profile is restricted to **Spine Binary 4.1.23**; there is no claim of all-version compatibility or official runtime parity. Rights to user assets remain with their owners.

## Animation timeline counts

The animation-wide timeline value is a capacity hint, not an equality constraint
on the decoded timelines. Per-group counts determine the encoded payload;
`declaredTimelines` in wire diagnostics preserves the original hint. Importing
continues when the hint differs from the decoded count, without dropping or
inventing tracks. Existing bounds on counts, references, keyframes and complete
input consumption still apply.

This behavior was checked through the public API of the pinned official
`@esotericsoftware/spine-core@4.1.23` runtime: a private input with hint 51 loads
49 timelines. Changing only that hint to 0, 1, 49 or 100000 preserves its decoded
timeline data in both readers. The public regression fixture is self-authored;
no official runtime code or private asset is included.

The [general binary format guide](https://esotericsoftware.com/spine-binary-format)
describes structural group counts but does not fully specify this 4.1 field.
The version-specific behavior above is based on reference execution, not an
assumption that every field named "count" must match a resulting array length.
