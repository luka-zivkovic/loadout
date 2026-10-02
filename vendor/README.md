# Optional Pi runner dependency

`pi-coding-agent-0.99.2-brace-fix.tgz` is the upstream `@earendil-works/pi-coding-agent@0.99.2` npm archive with one change to its bundled `npm-shrinkwrap.json`: `brace-expansion` is pinned to `5.0.12` instead of `5.0.9`, with npm's published tarball URL and integrity. The package has its own shrinkwrap, so a root `overrides` entry and `npm audit fix` do not replace the vulnerable nested version.

The original npm archive has integrity `sha512-6R1BZ2N77CrVcGf3eC2KovTz1Q4RYiAeydvVWQT546N2fi1nBc81aURlbOZCgruWoW9VY/UrLzDynF4YTolpoA==`. This patched archive has SHA-256 `a99803d2876056f137e3d35338a210ac92179240a96286912da7b5445465c8f7`. Its original package files are otherwise unchanged.

Replace this archive with an upstream release once that release pins a patched `brace-expansion`, then run `npm ci --ignore-scripts`, `npm audit`, and the Pi runner tests.
