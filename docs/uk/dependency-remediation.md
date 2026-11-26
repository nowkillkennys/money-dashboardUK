# Dependency remediation — 26 November 2026

This adaptation preserves the upstream MIT LICENSE unchanged. It does not enable cloud services, Gemini, external finance requests, imports or real records. Existing preview containers and databases were not restarted or changed by this dependency work.

## Selection and reproducibility

The primary [Next security release](https://nextjs.org/blog/november-2026-security-release) identifies 16.4.5 as the patched Active LTS release. The npm registry reported 16.4.6 as current when queried in Docker; Next and eslint-config-next are pinned together at 16.4.6. [React's version inventory](https://react.dev/versions) identifies 19.3 as current; React and ReactDOM are pinned to registry 19.3.1 with matching React 19 types. Lucide is updated to 1.81.0 for its declared React 19 peer support.

[Vitest's supported releases](https://vitest.dev/releases.html) include 5.1, and its [migration guide](https://vitest.dev/guide/migration/) requires Node >=22.12 and Vite >=6.4. Vitest is pinned to 5.1.2 and Vite explicitly to 8.3.8, removing Vitest 1/tinypool/Vite 5. Package engines constrain Node to >=22.12 <23, matching the existing Node 22 Docker runtime. pnpm 10.28.2 is recorded in packageManager to match Dockerfile.uk.

Sharp is overridden to 0.35.5, corroborated by [its upstream releases](https://github.com/lovell/sharp/releases). Zod is pinned to 4.6.7; source search found no direct app/lib Zod imports. @hookform/resolvers is updated to 5.2.2 for Zod 4 compatibility. TypeScript moves from 5.5 to the locked 5.9 line, Node types remain in 22, Autoprefixer becomes 10.7.0 and PostCSS 8.5.33. Existing compatible direct ranges are resolved by the lockfile, rather than installing against unbounded latest versions at runtime.

Root requested pg 8.23.1, @types/pg 8.23.1 and tsx 4.23.15 for its separate local PostgreSQL foundation; these are pinned. No database was opened by the dependency agent.

Security overrides are explicit: sharp 0.35.5; PostCSS 8.5.33; Babel core 7.29.6; browserslist 4.29.6; baseline-browser-mapping 2.11.0; selector-parser's v6 branch 6.1.5; brace-expansion's v1 branch 1.1.21 and >=2 branches 5.0.12; minimatch >=7 branches 11.0.1. The previous vulnerable esbuild 0.25.0 pin is removed, allowing the new Vite/tsx graph to resolve esbuild 0.28.2. Old ws/rollup blanket overrides are removed and the resolved graph is audited. Major transitive overrides require continued compiler/lint/build regression checks when the parent packages update.

All registry queries, lockfile generation, installation, audit and tests ran in Docker. Lockfile generation used `pnpm install --lockfile-only --ignore-scripts`; the named image `money-dashboard-uk-foundation:dependencies` uses Dockerfile.uk's `pnpm install --frozen-lockfile --ignore-scripts`. No host install or dependency lifecycle hook was executed. Installed package manifests were inventoried in `.uk-work/dependency-package-inventory.json`; the observed install hooks belonged to esbuild and unrs-resolver and remained disabled. This inventory includes package license declarations, but is not a complete redistributed-notice or asset clearance review. The existing onlyBuiltDependencies list does not override `--ignore-scripts`.

## Audit and verification evidence

Before: saved `.uk-work/dependency-audit.json` reported 57 advisory records (8 critical, 23 high, 22 moderate, 4 low), as triaged in upstream-security-review.md. After: Docker `pnpm audit --json` exited 0 and `.uk-work/dependency-audit-after.json` reports **zero critical, high, moderate, low or informational findings**, with 696 total dependency records. Registry advisory metadata does not establish absence of vulnerabilities or certify application security.

Initial fresh-image checks passed 94 inherited/UK/debt tests, with one separate in-progress workspace-auth suite unable to load its not-yet-created implementation at the image snapshot. Next 16.4.6 compiled the production bundle successfully, then typechecking exposed that same missing implementation plus the TypeScript 5.9 BufferSource typing change. Root owns that typing repair and final integrated verification. Initial ESLint 10 executed successfully but found five new React Compiler lint errors in existing components. Scoped repairs move account state before its effect, explicitly include stable ledger setters, and capture expense-category arrays before memoized callbacks without changing financial behavior. Fresh results are appended below.

## Remaining gates

[ESLint support policy](https://eslint.org/version-support/) marks v9 EOL and v10 current. ESLint 10.15.0 is selected, but Next's locked eslint-plugin-import 2.32.0, jsx-a11y 6.10.2 and react 7.37.5 still declare peers only through ESLint 9. This is an explicit upstream peer-support gap; successful execution is compatibility evidence, not a claim of vendor certification. Do not downgrade silently to unsupported ESLint 9 solely to hide warnings. Revisit when compatible plugin releases become available.

Google's [SDK migration guide](https://ai.google.dev/gemini-api/docs/migrate) classifies @google/generative-ai as legacy and recommends @google/genai. The legacy integration remains disabled in the isolated foundation/demo; enabling AI requires a separately reviewed SDK/API/model migration, privacy/opt-in controls and bounded live integration tests. No current SDK or model support claim is made for that disabled path.

Final root verification must cover the combined auth/domain work, network-disabled production build, browser smoke checks against an isolated candidate and unchanged evaluation boundary. Dockerfile.uk still includes the development graph in the disposable preview; minimal production packaging, image/OS vulnerability scanning, full third-party notices, provenance and the authentication/tenancy gates in upstream-security-review.md remain required before public/real-data use. A clean JavaScript dependency audit alone does not close those gates.

Fresh candidate verification (image source snapshot at approximately 10:52 UTC, before the remaining root ledger work): `pnpm run test` exited 0 with **100 tests / 21 files passed**; network-disabled `pnpm run build` with both UK demo flags exited 0, including TypeScript and static generation. `pnpm run lint` exited 0 with 0 errors and one category-dependency warning; the remaining warning was repaired by using the already captured category array consistently. These results cover this snapshot, not later concurrent changes or browser/database behavior.

After the final category-array consistency repair, the network-disabled lint rerun exited 0 with **zero errors and zero warnings** (`.uk-work/dependency-lint-final.log`). `git diff --check` also exited 0. Final combined-tree verification remains root's responsibility because other agents continue to add routes and domain code.
