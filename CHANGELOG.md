# Changelog

## [0.14.2](https://github.com/nikrich/hungry-ghost-hive/compare/v0.14.1...v0.14.2) (2026-02-06)


### Bug Fixes

* replace any type with proper GitHubPRState interface ([2cab62f](https://github.com/nikrich/hungry-ghost-hive/commit/2cab62f7d412af1fcb2b7bba93305a27fefa747c))

## [0.14.1](https://github.com/nikrich/hungry-ghost-hive/compare/v0.14.0...v0.14.1) (2026-02-06)


### Bug Fixes

* use actual repo contributors from GitHub API ([#172](https://github.com/nikrich/hungry-ghost-hive/issues/172)) ([019fa40](https://github.com/nikrich/hungry-ghost-hive/commit/019fa40cb18be6afe87fd1f5dff56f28d9a8e6dd))

## [0.14.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.13.1...v0.14.0) (2026-02-06)


### Features

* add GitHub PR template, issue templates, and CODE_OF_CONDUCT ([#167](https://github.com/nikrich/hungry-ghost-hive/issues/167)) ([b465148](https://github.com/nikrich/hungry-ghost-hive/commit/b465148c7cd4f4ec0756c12310a6d6b4bb164ebe))

## [0.13.1](https://github.com/nikrich/hungry-ghost-hive/compare/v0.13.0...v0.13.1) (2026-02-06)


### Bug Fixes

* correct license from MIT to Proprietary across README ([a1b9a08](https://github.com/nikrich/hungry-ghost-hive/commit/a1b9a08792032c30327f88784b3a9c2213462586))
* Correct license references from MIT to Proprietary ([e80ddb5](https://github.com/nikrich/hungry-ghost-hive/commit/e80ddb57c7da68867b0d76546395a58b1edfd664))

## [0.13.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.12.0...v0.13.0) (2026-02-06)


### Features

* **db:** add DAO abstraction with sqlite + leveldb implementations ([146b364](https://github.com/nikrich/hungry-ghost-hive/commit/146b36410bdca9053a2034a4432ea8eb09efe24f))

## [0.12.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.11.1...v0.12.0) (2026-02-06)


### Features

* Configure Vitest code coverage and enhance CI test reporting ([5e01ddb](https://github.com/nikrich/hungry-ghost-hive/commit/5e01ddbf52091d33cc2ca9abbfdd655776b09224))

## [0.11.1](https://github.com/nikrich/hungry-ghost-hive/compare/v0.11.0...v0.11.1) (2026-02-06)


### Bug Fixes

* resolve TypeScript error in branches.test.ts ([6d74870](https://github.com/nikrich/hungry-ghost-hive/commit/6d7487099de30e334e626f46146f1580a634e612))

## [0.11.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.10.3...v0.11.0) (2026-02-06)


### Features

* add shields.io badges to README header ([2e89556](https://github.com/nikrich/hungry-ghost-hive/commit/2e89556692761db2c4b95efbaa8094a82e77a235))

## [0.10.3](https://github.com/nikrich/hungry-ghost-hive/compare/v0.10.2...v0.10.3) (2026-02-06)


### Bug Fixes

* deliver initial prompts via CLI arg instead of tmux send-keys ([9a8b0a5](https://github.com/nikrich/hungry-ghost-hive/commit/9a8b0a561eb0c77a3b03da0a5fed9e55fbe67f3e))
* deliver initial prompts via CLI positional argument instead of tmux send-keys ([b388d31](https://github.com/nikrich/hungry-ghost-hive/commit/b388d31c246174f92caeea60c311d94ce9a26341))

## [0.10.2](https://github.com/nikrich/hungry-ghost-hive/compare/v0.10.1...v0.10.2) (2026-02-06)


### Bug Fixes

* **manager:** continuously enforce bypass mode on all agents [STORY-REF-014] ([2145eb4](https://github.com/nikrich/hungry-ghost-hive/commit/2145eb4e2315b245cb80e6fd9502faf452bff6b6))
* resolve merge conflict in manager.ts imports ([071d3b3](https://github.com/nikrich/hungry-ghost-hive/commit/071d3b3597580537897d5b27e78aadbe5eacf278))

## [0.10.1](https://github.com/nikrich/hungry-ghost-hive/compare/v0.10.0...v0.10.1) (2026-02-06)


### Bug Fixes

* use tmux bracket paste for multi-line prompt delivery ([162b0fd](https://github.com/nikrich/hungry-ghost-hive/commit/162b0fd7f51dc1cc3f6228f78653fec81dd36e12))
* use tmux bracket paste for multi-line prompt delivery ([08174f4](https://github.com/nikrich/hungry-ghost-hive/commit/08174f4aa81c42767e52d059a59693711b832c11))

## [0.10.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.9.0...v0.10.0) (2026-02-06)


### Features

* add terminated agents footnote and improve agent count display ([72264db](https://github.com/nikrich/hungry-ghost-hive/commit/72264dbb308c5af0c906bfa56c11b22f5adaf02d))
* ensure agents maintain bypass permissions mode throughout lifecycle ([8002763](https://github.com/nikrich/hungry-ghost-hive/commit/800276310d28eebe80ba153de57c92b9c0bcc91b))
* implement bypass mode enforcement and permission auto-approval for STORY-REF-017 ([5840e9a](https://github.com/nikrich/hungry-ghost-hive/commit/5840e9a3b9579672e7c7054fac8b6e4614a23cdf))
* require explicit story_id on PR submission and unify story ID regex ([37f7cc0](https://github.com/nikrich/hungry-ghost-hive/commit/37f7cc02b52d02e999afa3af110bdd63274795e0))
* **scheduler:** create escalation on model-cli tool compatibility mismatch ([6d850b5](https://github.com/nikrich/hungry-ghost-hive/commit/6d850b5cdd2c4bdeb795643511d246148fcda053))
* **scheduler:** detect and recover orphaned stories from terminated agents ([f118a5a](https://github.com/nikrich/hungry-ghost-hive/commit/f118a5ac4ea8fbee144d8a57ea67284adfd50b2d))
* skip auto-merge for conflicting PRs ([9c51ddb](https://github.com/nikrich/hungry-ghost-hive/commit/9c51ddbd3c4c47f6ae3503ff98ea7488c62e1f28))
* **story-ref-015:** validate cli tool compatibility with model at spawn time ([6ce4b98](https://github.com/nikrich/hungry-ghost-hive/commit/6ce4b980737420095a779003fcda3d34a9368c61))
* track QA failure attempts per story and escalate after 3 rejections ([de3b64a](https://github.com/nikrich/hungry-ghost-hive/commit/de3b64a400ecb7ed4b63286b48990b856bd6624f))
* wrap manager state mutations in transactions ([0968652](https://github.com/nikrich/hungry-ghost-hive/commit/09686520e9b5cdd1fa6739507748d4d27bf95f8e))


### Bug Fixes

* **auto-merge:** check GitHub PR state before attempting merge ([50a69cc](https://github.com/nikrich/hungry-ghost-hive/commit/50a69cc51fc49ffd55f25dec1c34745e8b68faf2))
* **auto-merge:** correctly map GitHub PR state to database status ([ebe79d3](https://github.com/nikrich/hungry-ghost-hive/commit/ebe79d33e2fbbdc2047e43ab2e66317ad5af4b3e))
* **cleanup:** replace any types with DatabaseClient ([9a38225](https://github.com/nikrich/hungry-ghost-hive/commit/9a382250736606ab62c964261c7af4238a4cd931))
* **cleanup:** replace any types with DatabaseClient for type safety ([5d440b6](https://github.com/nikrich/hungry-ghost-hive/commit/5d440b6b54f7bb618af8ac5665fc9992aafd1f78))
* improve type safety in cleanup command by removing 'any' types ([61a2702](https://github.com/nikrich/hungry-ghost-hive/commit/61a2702481376ad56114ecc4af455d1f9f3c792c))
* **logs:** add AGENT_SPAWN_FAILED event type to EventType union ([28edf0e](https://github.com/nikrich/hungry-ghost-hive/commit/28edf0e3949989f75b250001390b1cfa9a36ba7e))
* **logs:** add PR_MERGE_SKIPPED event type ([254b054](https://github.com/nikrich/hungry-ghost-hive/commit/254b054be383f9fc1b19c578a3267c0eff02629d))
* maintain backward compatibility by keeping active field in status ([809092d](https://github.com/nikrich/hungry-ghost-hive/commit/809092d81738b446114fa495be88d3fdd9ce2f25))
* properly use error variable in dashboard catch block ([ef5f29f](https://github.com/nikrich/hungry-ghost-hive/commit/ef5f29f84d4b1c3c404e1327247b0fc90459df08))
* remove unused error variable in dashboard debug logging ([f894dc3](https://github.com/nikrich/hungry-ghost-hive/commit/f894dc3981eb09546c561b5b2576b2e0e87b6f8e))
* remove unused error variable in dashboard debug logging ([4e0c08f](https://github.com/nikrich/hungry-ghost-hive/commit/4e0c08fe8c372e9168ad78c32a4030b5734ae347))
* **scheduler:** use actual cli_tool for bypass mode and remove redundant declaration ([4db78d5](https://github.com/nikrich/hungry-ghost-hive/commit/4db78d592318bda20754e940f5e374e0e3543225))
* **scheduler:** use atomic update for orphaned story recovery ([104f391](https://github.com/nikrich/hungry-ghost-hive/commit/104f391d4426a486daaa17715d2579a3ef58bed8))
* show only active agents in hive status total count ([0f20b2d](https://github.com/nikrich/hungry-ghost-hive/commit/0f20b2d856495311054b86900287bce84cf67bd9))
* show only active agents in hive status total count ([f590c77](https://github.com/nikrich/hungry-ghost-hive/commit/f590c7760247fed892960526f64dd9b231aff6e7))

## [0.9.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.8.0...v0.9.0) (2026-02-06)


### Features

* add comprehensive tests for immediate auto-merge functionality ([#117](https://github.com/nikrich/hungry-ghost-hive/issues/117)) ([2299f48](https://github.com/nikrich/hungry-ghost-hive/commit/2299f4835eede6cce6eb882fe87e0beaefacaf24))
* **escalations:** persist dedup state and add auto-resolution ([#113](https://github.com/nikrich/hungry-ghost-hive/issues/113)) ([cf7f407](https://github.com/nikrich/hungry-ghost-hive/commit/cf7f407c545015c3df21a90bd16e128d3252438c))
* implement reliable message forwarding with delivery confirmation ([23133dc](https://github.com/nikrich/hungry-ghost-hive/commit/23133dc9a83be2edfff3513f2ed62a888846c174))
* **manager:** add configurable timeouts to all shell commands ([#116](https://github.com/nikrich/hungry-ghost-hive/issues/116)) ([afcfaf8](https://github.com/nikrich/hungry-ghost-hive/commit/afcfaf84b9a295a5a0ac067a23d88429b1ff63c2))


### Bug Fixes

* **dashboard:** add debug log rotation and document configurable refresh interval ([f659281](https://github.com/nikrich/hungry-ghost-hive/commit/f659281fd8529c38a53737d7d849c6b08ec8c280))
* **dashboard:** prevent overlapping refreshes and always show current data ([7c45012](https://github.com/nikrich/hungry-ghost-hive/commit/7c45012fecbb669fc7e4ad8332dd3effcc763c43))
* **db:** use BEGIN IMMEDIATE for all write transactions ([3ee4f51](https://github.com/nikrich/hungry-ghost-hive/commit/3ee4f51e2014bbf3932050fbb907454c94dc654d))
* **db:** use BEGIN IMMEDIATE for all write transactions [STORY-REF-001] ([d6e996c](https://github.com/nikrich/hungry-ghost-hive/commit/d6e996c7be10ab773631644f82219d38c4b393d7))
* ensure github_pr_number is populated when PRs are submitted ([#115](https://github.com/nikrich/hungry-ghost-hive/issues/115)) ([42d94ac](https://github.com/nikrich/hungry-ghost-hive/commit/42d94acbb7a90cbfe77fe5eead2f038914c76d77))
* **state-detection:** improve claude-code-state detection accuracy ([#121](https://github.com/nikrich/hungry-ghost-hive/issues/121)) ([5699c34](https://github.com/nikrich/hungry-ghost-hive/commit/5699c34ac000b7791541ff40fc58861ab8637265))

## [0.8.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.7.0...v0.8.0) (2026-02-06)


### Features

* add hive version command with dynamic version from package.json ([#105](https://github.com/nikrich/hungry-ghost-hive/issues/105)) ([f5a3d6a](https://github.com/nikrich/hungry-ghost-hive/commit/f5a3d6a677ccf7d6c1a73ade6cbd670d8d056f7c))
* implement prioritized merge queue ordering ([#107](https://github.com/nikrich/hungry-ghost-hive/issues/107)) ([9d8d1ba](https://github.com/nikrich/hungry-ghost-hive/commit/9d8d1ba72f474ba5a784abafffe88312b7d8c782))
* **scheduler:** prevent multiple agents from being assigned to same story ([#106](https://github.com/nikrich/hungry-ghost-hive/issues/106)) ([0f32b60](https://github.com/nikrich/hungry-ghost-hive/commit/0f32b6084aaba37d9574ba3ea3c52eeacc3c6678))

## [0.7.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.6.3...v0.7.0) (2026-02-06)


### Features

* auto-merge approved PRs immediately on approval ([#103](https://github.com/nikrich/hungry-ghost-hive/issues/103)) ([d4b3f65](https://github.com/nikrich/hungry-ghost-hive/commit/d4b3f6535681330ad02ab4ac7e4e01dc20350ab9))

## [0.6.3](https://github.com/nikrich/hungry-ghost-hive/compare/v0.6.2...v0.6.3) (2026-02-06)


### Bug Fixes

* populate github_pr_number when PRs are submitted ([8be832a](https://github.com/nikrich/hungry-ghost-hive/commit/8be832a511ade86b5c7a3368fd4ba9f0a8c6edab))


### Performance Improvements

* eliminate N+1 queries in dependency graph building ([b8f093f](https://github.com/nikrich/hungry-ghost-hive/commit/b8f093f27e92dfbd54d6bc99b8676c45df83fb64))
* eliminate N+1 queries in dependency graph building ([efa7af4](https://github.com/nikrich/hungry-ghost-hive/commit/efa7af4ea0eefc45e2a6945388dbd352a78eedb5))

## [0.6.2](https://github.com/nikrich/hungry-ghost-hive/compare/v0.6.1...v0.6.2) (2026-02-06)


### Bug Fixes

* populate github_pr_number when PRs are submitted ([#93](https://github.com/nikrich/hungry-ghost-hive/issues/93)) ([904a92f](https://github.com/nikrich/hungry-ghost-hive/commit/904a92f19fe983e1fa60fb79a1b6fbcb3b0d2d00))

## [0.6.1](https://github.com/nikrich/hungry-ghost-hive/compare/v0.6.0...v0.6.1) (2026-02-06)


### Bug Fixes

* use prepared statements in heartbeat test to fix build ([#95](https://github.com/nikrich/hungry-ghost-hive/issues/95)) ([b1a223e](https://github.com/nikrich/hungry-ghost-hive/commit/b1a223e1fd91ebb53a40e136bc36c6568048657e))

## [0.6.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.5.0...v0.6.0) (2026-02-06)


### Features

* auto-close duplicate PRs when new PR submitted for same story ([#80](https://github.com/nikrich/hungry-ghost-hive/issues/80)) ([cf06c39](https://github.com/nikrich/hungry-ghost-hive/commit/cf06c39e202c6658dfba5d817c2a93fc5c6b2371))
* implement --dry-run flag for hive assign command ([163fa22](https://github.com/nikrich/hungry-ghost-hive/commit/163fa223a249dec59611a256bf2aae955187f083))
* implement --dry-run flag for hive assign command ([dd831b4](https://github.com/nikrich/hungry-ghost-hive/commit/dd831b41529cb3272f87858b1df359752c74b691))
* update default model IDs to latest Claude versions ([#84](https://github.com/nikrich/hungry-ghost-hive/issues/84)) ([1161419](https://github.com/nikrich/hungry-ghost-hive/commit/1161419a3cfb4b261b10187e297aa3079ea1c395))

## [0.5.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.4.1...v0.5.0) (2026-02-06)


### Features

* make QA agent scaling configurable via hive.config.yaml ([49471e1](https://github.com/nikrich/hungry-ghost-hive/commit/49471e14b4fcf03f5d785a97b898dbcbcfe798a4))

## [0.4.1](https://github.com/nikrich/hungry-ghost-hive/compare/v0.4.0...v0.4.1) (2026-02-06)


### Bug Fixes

* optimize manager daemon to eliminate N+1 queries ([64744fc](https://github.com/nikrich/hungry-ghost-hive/commit/64744fc04b381789351c177f579a065231fde823))

## [0.4.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.3.1...v0.4.0) (2026-02-06)


### Features

* add comprehensive cleanup command for orphaned resources ([7013aa2](https://github.com/nikrich/hungry-ghost-hive/commit/7013aa29d8c45da023f4fa389e59736b3bb25e35))
* **db:** add database indexes for query performance ([2fc3b06](https://github.com/nikrich/hungry-ghost-hive/commit/2fc3b060559508f9b2ba87a5742a760dc7f9ccb3))
* **scheduler:** refactor duplicated agent spawn methods into generic spawnAgent ([049eae2](https://github.com/nikrich/hungry-ghost-hive/commit/049eae2f475febeb5f386f2ba2e6defd99f0f52f))
* update default model IDs to latest Claude versions ([a551fca](https://github.com/nikrich/hungry-ghost-hive/commit/a551fca2edbbf5f065dcc522fe3efd05670209ce))


### Bug Fixes

* change versionMap from let to const to fix linting error ([85f409b](https://github.com/nikrich/hungry-ghost-hive/commit/85f409bd4e4878d6e17dff3f32e0c41bfb89a0ae))
* change versionMap from let to const to fix linting error ([a52e0d0](https://github.com/nikrich/hungry-ghost-hive/commit/a52e0d0b2819a7dac72e8df6a73702ff9c70a10a))

## [0.3.1](https://github.com/nikrich/hungry-ghost-hive/compare/v0.3.0...v0.3.1) (2026-02-06)


### Bug Fixes

* correct license field from MIT to custom license ([4251ac4](https://github.com/nikrich/hungry-ghost-hive/commit/4251ac43d47fab37da3411958127b35d9883f752))
* use release tag name for tarball upload in release workflow ([e5f1a59](https://github.com/nikrich/hungry-ghost-hive/commit/e5f1a5975b7ad5060cefd30527f0b6422eb07f70))

## [0.3.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.2.0...v0.3.0) (2026-02-06)


### Features

* add npm publish step to release workflow ([de0b11e](https://github.com/nikrich/hungry-ghost-hive/commit/de0b11eb60c0e4534c2fc5a5b5ea41db016ed4b3))
* Add npm publish step to release workflow (STORY-REL-004) ([047f1db](https://github.com/nikrich/hungry-ghost-hive/commit/047f1db18ab6117ee2e303e3687c9175aa10cdfc))

## [0.2.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.1.4...v0.2.0) (2026-02-06)


### Features

* add commitlint and husky for conventional commit enforcement ([71bbb11](https://github.com/nikrich/hungry-ghost-hive/commit/71bbb11654e8c983d925debad886a161e8726934))
* add conventional commit enforcement with commitlint and husky ([887c915](https://github.com/nikrich/hungry-ghost-hive/commit/887c9150da17dda55c7f574649d99f8e1678273d))


### Bug Fixes

* Add missing migration 005 for last_seen column ([49264bf](https://github.com/nikrich/hungry-ghost-hive/commit/49264bfc2cfd267407544342ef9738f3ac584bed))
* resolve merge conflicts and remove duplicate commitlint config ([0fd0459](https://github.com/nikrich/hungry-ghost-hive/commit/0fd0459e66661b344bdd5c83d9871f3f496e754a))
* use correct release-please action and remove invalid input ([6bf2ac1](https://github.com/nikrich/hungry-ghost-hive/commit/6bf2ac1505731d1b2f871ee269d0bc5818006cec))
