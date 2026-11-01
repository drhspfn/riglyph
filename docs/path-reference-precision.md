# Path world-affine numerical acceptance policy

The Spine 4.1.24 black-box oracle emits **float32** affine matrices.
All reference matrix components are unchanged and tested individually.

- Default absolute error for every matrix component: **1e-4**.
- For a **world translation component only** (`x` or `y`) where the reference
  magnitude is at least 256, the accepted difference is at most **six ULPs of
  IEEE-754 binary32** for the reference magnitude, or 1e-4, whichever is greater.
- The extra allowance is not used for matrix basis components (rotation,
  reflection, scale, shear), nor for positions below 256, nor for scene validity.
- Every failure prints the unmodified expected and actual matrices and the
  actual maximum absolute difference; oversized residuals remain failures.

**Rationale:** reference evaluation accumulates float32 rounding during path
extrapolation (e.g. offsets from the path beyond 500–1200 world units);
Riglyph deliberately performs geometry calculations in JavaScript float64
before returning canonical affine matrices. A difference of 2–6 float32
representable increments at those magnitudes can exceed 1e-4 without a
meaningful geometric discrepancy. This *narrow* exception follows the
handoff's explicit floating-point edge-case provision. No goldens or
source inputs are modified and all non-translation errors remain strict.
