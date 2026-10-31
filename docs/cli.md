# Riglyph CLI

Commands (installed as `riglyph`):

```sh
riglyph --help
riglyph --version
riglyph probe character.skel
riglyph wire character.skel
riglyph convert character.skel --atlas character.atlas --images ./ --out-dir ./public/assets/character
# To replace an existing converted folder (with rollback on failure):
riglyph convert character.skel --atlas character.atlas --images ./ --out-dir ./public/assets/character --overwrite
riglyph validate ./public/assets/character/skeleton.ir.json
riglyph stats ./public/assets/character/skeleton.ir.json
riglyph capabilities ./public/assets/character/skeleton.ir.json
```

`convert` is build-time only and writes `manifest.json`, IR and texture pages transactionally. Missing or mismatched PNG, unknown format/version, invalid IR, unsafe paths and active unsupported semantics fail explicitly. `convert` refuses an existing destination with typed `OUTPUT_EXISTS` unless you explicitly supply `--overwrite`. With `--overwrite`, Riglyph builds a complete sibling staging directory, moves the previous output to a unique sibling backup, renames the new directory into place, and removes the backup after successful commit. If the commit fails (including Windows `EPERM`), it restores the previous directory; if restoration itself fails, `OUTPUT_ROLLBACK_FAILED` reports the retained backup path for manual recovery. This is a file-system transaction, not an overwrite of individual files. Use `riglyph import FILE --atlas ... --out FILE.json` if you need just IR. When running through npm use `npm run cli -- convert ...`; do not omit `--`.
