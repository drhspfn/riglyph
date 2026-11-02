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


## Render complete animations (A21)

```sh
riglyph render skeleton.ir.json --images ./textures --clip idle --out-dir ./renders/png --fps 60
riglyph render skeleton.ir.json --images ./textures --clip idle --format mp4 --out ./renders/idle.mp4 --background '#00FF00'
riglyph render skeleton.ir.json --images ./textures --clip idle --format webm --out ./renders/idle.webm --alpha
riglyph render skeleton.ir.json --config ./render-config.json --fps 30
riglyph render --help
```

`render` is separate from the original `snapshot` command. It generates
multiple actual independently sampled animation frames without a browser.
PNG sequences default to transparent alpha and work without FFmpeg; video
requires the requested encoder and ffprobe. Output settings, camera modes,
frame numbering, cancel/overwrite and cross-platform examples are documented
in [headless rendering](headless-rendering.md) and [video export](video-export.md).
