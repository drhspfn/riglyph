# Architecture

`format detectors -> importer registry -> exact source-version adapter -> validated immutable IR 1.0.0 -> mutable skeleton instance -> AnimationPlayer -> draw packets -> WebGL2 / CPU renderer`. CLI performs build-time import; Web Player loads a portable manifest and textures without importing binary runtime dependencies. Compatibility is **per verified source version**, not by filename extension. The v0.15.1 package set implements only Spine Binary 4.1.23.
