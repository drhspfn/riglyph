# Creating a versioned importer plugin

The engine's contract is **source-specific decoding → canonical IR v1.0.0 → version-neutral evaluator → version-neutral rendering**. An importer is trusted executable code, not a sandbox. Register only modules explicitly chosen by the application operator. Do not inspect official Spine Runtime source, ports, decompiled implementations, game asset packs or other restricted sources during clean-room development.

## The SDK API

Install `@riglyph/importer-sdk@0.8.0` and `@riglyph/core@0.8.0`. The package exposes `AdapterRegistry`, `FormatDetector`, `DetectedIdentity`, `ImportAdapter`, `ImporterManifest`, `ImportInput`, `ImportResult`, `sha256`, and typed `EngineError` (from core). Importers own source decoding and normalization, never the runtime.

`FormatDetector.inspect(headerBytes, source)` recognizes `{family,version,confidence,detectorId}`. For custom families, register their own detector before importing. Detectors are independent of installed importer packages. They have a bounded maximum number of probe bytes (`maxProbeBytes`, default 4096) and are not allowed to guess a version from a `.skel` extension alone. `spineBinaryDetector` recognizes the confirmed 4.1.23 header; other versions decoded from the same prefix are *tentative* until separately verified.

A plugin must export `importerPlugin: ImportAdapter` with `id`, `family`, an explicit `acceptedVersions` allowlist, `adapterVersion`, `manifest`, `probe` and `import`. Optional capabilities are `wire` and `inspectHeader`. The `manifest` declares its package version, source versions, output IR schemas, tested capabilities and license. Version-mismatched plugins are not selected. Two plugins claiming the same family/version cause `AMBIGUOUS_IMPORTER`, never first-registered-wins.

```ts
import {AdapterRegistry,sha256} from '@riglyph/importer-sdk';
import {validateIR} from '@riglyph/core';
import type {ImportAdapter,FormatDetector} from '@riglyph/importer-sdk';

export const detector:FormatDetector={
  id:'my-open-format-detector',
  inspect(bytes){
    // Check a documented, independently established magic and version field.
    // Return null for other families; throw EngineError for a malformed recognized header.
    return null;
  }
};
export const importerPlugin:ImportAdapter={
  id:'my-open-format-1',family:'my-open-format',acceptedVersions:['1.0.0'],
  adapterVersion:'0.1.0',
  manifest:{id:'my-open-format-1',packageVersion:'0.1.0',formatFamilies:['my-open-format'],
    supportedSourceVersions:['1.0.0'],producedIrSchemaVersions:['1.0.0'],
    capabilities:['my-verified-feature'],license:'MIT'},
  probe(bytes,source){return detector.inspect(bytes,source);},
  import(input){
    // Implement actual bounded binary/text decoding and lossless normalization here.
    // Never return a demo fixture as if it were a real source import.
    throw new Error('Implement the independently specified format first');
  }
};

const registry=new AdapterRegistry();
registry.registerDetector(detector);
registry.register(importerPlugin);
// const result=registry.import({bytes,source:'example.asset'});
```

The code above is a *template illustrating the contract*, not a working new-format parser. A fully executable, independently authored synthetic QA plugin lives at `examples/synthetic-importer/index.mjs` with `family=synthetic-test`, `acceptedVersions=['2.0.0']`. It does **not** claim Spine 4.2 support. Its test is in `tests/g4-modular.test.ts`.

## CLI configuration — G5

The CLI includes the exact 4.1.23 plugin and independent synthetic QA adapter. For a new family, an explicitly trusted installed ESM module must export **named** `importerPlugin` and optionally `detector` or `detectors` (array). The CLI registers these atomically, just like `registry.registerModule(module)`. A plugin supplying only `default` must migrate to named `importerPlugin` (pre-v1.0 controlled breaking change). No global auto-discovery, remote plugin download or input-driven module execution is allowed.

```sh
riglyph probe file.xyz --plugin file:///trusted/xyz-importer.mjs
riglyph import file.xyz --out file.ir.json --plugin file:///trusted/xyz-importer.mjs
```

Or `--plugins-config configured-plugins.json` with `{ "plugins": ["file:///trusted/xyz-importer.mjs"] }`. `probe` reports `identity`, `availability`, `compatiblePlugin`; it does **not** require the importer to be installed. `import/wire` require a matching exact source-version allowlist. The complete independently authored `XYZ/2.0.0` synthetic plugin is at `examples/custom-family/index.mjs`, covered by both in-repo and external tarball tests. See `docs/g5-importer-cli.md`.

## Required validation and failure modes

- Read no more than the configured input limit; validate every count/length before allocation, check EOF exactly, reject malformed strings, varints, references and topology.
- Preserve the precise detected `source.version` separately from `adapterVersion` and `schemaVersion`; calculate an actual SHA-256 of source bytes.
- Normalize into IR v1.0.0 including atlas references, tint, deform, timelines and constraints; call `validateIR` before reporting success.
- `report.bytesConsumed` must equal the complete source byte count. Report `losses=[]` and `unsupported=[]` only if none are present, never return an apparently complete result with missing semantic fields.
- Do not silently fall back between versions. Use typed errors: `UNRECOGNIZED_FORMAT`, `INVALID_HEADER`, `TRUNCATED_INPUT`, `UNSUPPORTED_VERSION`, `AMBIGUOUS_IMPORTER`, `IMPORTER_PROBE_FAILED`, `UNSUPPORTED_IR_SCHEMA`, `UNSUPPORTED_SEMANTIC_FEATURE`.
- Build fixtures yourself with clear origin records. For any private conformance fixtures, send only sanitized structural/numeric reports to the implementing agent.
- Test multiple independently managed skeleton instances and a third-party adapter without source-version branches inside universal runtime.

## Conformance and publication

Test correct version, a source version *not* in the allowlist, incomplete header, unsupported feature, malformed/truncated record, ambiguous plugins and late plugin registration. Pack the `.tgz`, install it from a clean directory, and test both ESM and `.d.ts` separately. Verify license, provenance and third-party notices. Do not advertise patch versions by inference. Publish only after explicit user authorization and independent rights review.
