# Changelog

## [0.22.2](https://github.com/nikrich/hungry-ghost-hive/compare/hungry-ghost-hive-v0.22.1...hungry-ghost-hive-v0.22.2) (2026-02-08)


### Bug Fixes

* enforce no-work-without-assignment rule in agent prompts ([b247539](https://github.com/nikrich/hungry-ghost-hive/commit/b247539c36d2f1700ddd68ddb8c81361eb704039))
* only spawn agents when assignable work exists in checkScaling ([#271](https://github.com/nikrich/hungry-ghost-hive/issues/271)) ([e997928](https://github.com/nikrich/hungry-ghost-hive/commit/e9979282a0265d4aa58c6632b1b625bcd1f04807))
* remove FK constraint on agent_logs.agent_id ([b88b8cb](https://github.com/nikrich/hungry-ghost-hive/commit/b88b8cb7e98e767bceb9c4872f12c976cbaeb6a8))

## [0.22.1](https://github.com/nikrich/hungry-ghost-hive/compare/hungry-ghost-hive-v0.22.0...hungry-ghost-hive-v0.22.1) (2026-02-08)


### Bug Fixes

* format manager.ts and tmux/manager.ts to pass prettier check ([4e0db99](https://github.com/nikrich/hungry-ghost-hive/commit/4e0db99658f64635c5dea45eca67d231a963778d))

## [0.22.0](https://github.com/nikrich/hungry-ghost-hive/compare/hungry-ghost-hive-v0.21.8...hungry-ghost-hive-v0.22.0) (2026-02-08)


### Features

* add version number to dashboard top bar ([#266](https://github.com/nikrich/hungry-ghost-hive/issues/266)) ([39eb9a3](https://github.com/nikrich/hungry-ghost-hive/commit/39eb9a30bea37ac6d55691a2fe88fb709000d4e1))

## [0.21.8](https://github.com/nikrich/hungry-ghost-hive/compare/hungry-ghost-hive-v0.21.7...hungry-ghost-hive-v0.21.8) (2026-02-08)


### Bug Fixes

* format pr-sync.ts to pass prettier check ([03e2514](https://github.com/nikrich/hungry-ghost-hive/commit/03e2514dead8ba638deced6daddfd415dc64a60b))
* use explicit -R flag for gh CLI to prevent fork repo resolution ([#263](https://github.com/nikrich/hungry-ghost-hive/issues/263)) ([62b6b88](https://github.com/nikrich/hungry-ghost-hive/commit/62b6b8811476bc8f4c7ea4f784988eab3224210d))

## [0.21.7](https://github.com/nikrich/hungry-ghost-hive/compare/hungry-ghost-hive-v0.21.6...hungry-ghost-hive-v0.21.7) (2026-02-08)


### Bug Fixes

* prevent agent record loss from concurrent database access ([#260](https://github.com/nikrich/hungry-ghost-hive/issues/260)) ([56b7787](https://github.com/nikrich/hungry-ghost-hive/commit/56b7787de26367436057605eef95950ca9d84f08))
* save database immediately after spawning agents ([#261](https://github.com/nikrich/hungry-ghost-hive/issues/261)) ([e091056](https://github.com/nikrich/hungry-ghost-hive/commit/e0910566faa305f8b1bc6c318ceb6800a23ded7d))

## [0.21.6](https://github.com/nikrich/hungry-ghost-hive/compare/hungry-ghost-hive-v0.21.5...hungry-ghost-hive-v0.21.6) (2026-02-08)


### Bug Fixes

* prevent database wipe from corrupted sql.js buffer loading ([#257](https://github.com/nikrich/hungry-ghost-hive/issues/257)) ([c9942b6](https://github.com/nikrich/hungry-ghost-hive/commit/c9942b65b554211712396753a132d297becbcf87))

## [0.21.5](https://github.com/nikrich/hungry-ghost-hive/compare/hungry-ghost-hive-v0.21.4...hungry-ghost-hive-v0.21.5) (2026-02-07)


### Bug Fixes

* auto-close stale GitHub PRs when submitting new PRs ([#254](https://github.com/nikrich/hungry-ghost-hive/issues/254)) ([44ad714](https://github.com/nikrich/hungry-ghost-hive/commit/44ad7140d879372227ee477304c3b515944fbc57))

## [0.21.4](https://github.com/nikrich/hungry-ghost-hive/compare/hungry-ghost-hive-v0.21.3...hungry-ghost-hive-v0.21.4) (2026-02-07)


### Bug Fixes

* detect already-merged PRs to correctly transition story status ([#249](https://github.com/nikrich/hungry-ghost-hive/issues/249)) ([0f768a4](https://github.com/nikrich/hungry-ghost-hive/commit/0f768a407c58d37a02d280a4efd486ac5cf7ef85))

## [0.21.3](https://github.com/nikrich/hungry-ghost-hive/compare/hungry-ghost-hive-v0.21.2...hungry-ghost-hive-v0.21.3) (2026-02-07)


### Bug Fixes

* only notify idle QA agents to prevent work interruptions ([#252](https://github.com/nikrich/hungry-ghost-hive/issues/252)) ([0878b39](https://github.com/nikrich/hungry-ghost-hive/commit/0878b39a438e69abe12270f36261bb2479568d3d))

## [0.21.2](https://github.com/nikrich/hungry-ghost-hive/compare/hungry-ghost-hive-v0.21.1...hungry-ghost-hive-v0.21.2) (2026-02-07)


### Bug Fixes

* exclude terminated agents from tmux_session lookups in my-stories ([#248](https://github.com/nikrich/hungry-ghost-hive/issues/248)) ([f5eb0d7](https://github.com/nikrich/hungry-ghost-hive/commit/f5eb0d7744754a9a704d9c7d7de869d70660a59f))

## [0.21.1](https://github.com/nikrich/hungry-ghost-hive/compare/hungry-ghost-hive-v0.21.0...hungry-ghost-hive-v0.21.1) (2026-02-07)


### Bug Fixes

* harden tmux spawn command handling and cluster API exposure ([#243](https://github.com/nikrich/hungry-ghost-hive/issues/243)) ([34b1a28](https://github.com/nikrich/hungry-ghost-hive/commit/34b1a280967788b3d3b8fdc0a0b4f84f9322ca81))

## [0.21.0](https://github.com/nikrich/hungry-ghost-hive/compare/hungry-ghost-hive-v0.20.1...hungry-ghost-hive-v0.21.0) (2026-02-07)


### Features

* **config:** upgrade agent models - Senior to Opus 4.6, Intermediate to Sonnet ([#234](https://github.com/nikrich/hungry-ghost-hive/issues/234)) ([253c18f](https://github.com/nikrich/hungry-ghost-hive/commit/253c18f15080d7a864007e8ccb3b890827714315))
* **my-stories:** enforce dependency checking in claim command ([#237](https://github.com/nikrich/hungry-ghost-hive/issues/237)) ([6687d26](https://github.com/nikrich/hungry-ghost-hive/commit/6687d260be6738f32735f8a5756155211b5e2266))

## [0.20.1](https://github.com/nikrich/hungry-ghost-hive/compare/hungry-ghost-hive-v0.20.0...hungry-ghost-hive-v0.20.1) (2026-02-07)


### Bug Fixes

* prevent manager from killing busy agents after story merge ([#240](https://github.com/nikrich/hungry-ghost-hive/issues/240)) ([a83adaa](https://github.com/nikrich/hungry-ghost-hive/commit/a83adaa178d7d67bc208fcd6213bc07f0d172626))

## [0.20.0](https://github.com/nikrich/hungry-ghost-hive/compare/hungry-ghost-hive-v0.19.1...hungry-ghost-hive-v0.20.0) (2026-02-07)


### Features

* route stories that block others to senior agents regardless of complexity ([#238](https://github.com/nikrich/hungry-ghost-hive/issues/238)) ([ce18092](https://github.com/nikrich/hungry-ghost-hive/commit/ce1809200bcdeb64ab769a064b911c5f179d1dce))

## [0.19.1](https://github.com/nikrich/hungry-ghost-hive/compare/hungry-ghost-hive-v0.19.0...hungry-ghost-hive-v0.19.1) (2026-02-07)


### Performance Improvements

* optimize PR sync hot-path lookups ([#231](https://github.com/nikrich/hungry-ghost-hive/issues/231)) ([dd118fb](https://github.com/nikrich/hungry-ghost-hive/commit/dd118fba9525377615e6c9d41dd8282f52f8eb49))

## [0.19.0](https://github.com/nikrich/hungry-ghost-hive/compare/hungry-ghost-hive-v0.18.2...hungry-ghost-hive-v0.19.0) (2026-02-07)


### Features

* add --godmode flag to hive req command (STORY-GOD-001) ([e602616](https://github.com/nikrich/hungry-ghost-hive/commit/e6026160ef300a72d1fd2a6d8b3ee8fb1fdaeb44))
* add commitlint and husky for conventional commit enforcement ([71bbb11](https://github.com/nikrich/hungry-ghost-hive/commit/71bbb11654e8c983d925debad886a161e8726934))
* add comprehensive cleanup command for orphaned resources ([7013aa2](https://github.com/nikrich/hungry-ghost-hive/commit/7013aa29d8c45da023f4fa389e59736b3bb25e35))
* add comprehensive tests for immediate auto-merge functionality ([#117](https://github.com/nikrich/hungry-ghost-hive/issues/117)) ([2299f48](https://github.com/nikrich/hungry-ghost-hive/commit/2299f4835eede6cce6eb882fe87e0beaefacaf24))
* add conventional commit enforcement with commitlint and husky ([887c915](https://github.com/nikrich/hungry-ghost-hive/commit/887c9150da17dda55c7f574649d99f8e1678273d))
* add database transaction wrapper for atomic multi-step operations ([50285bd](https://github.com/nikrich/hungry-ghost-hive/commit/50285bd6de3597a1b432c6efd6c457dab27651d2))
* add enterprise README polish with features, code quality, and contributing sections ([a7e21de](https://github.com/nikrich/hungry-ghost-hive/commit/a7e21de1b7ec7cb73c897399a05672ed9b4d7b90))
* add GitHub PR template, issue templates, and CODE_OF_CONDUCT ([#167](https://github.com/nikrich/hungry-ghost-hive/issues/167)) ([b465148](https://github.com/nikrich/hungry-ghost-hive/commit/b465148c7cd4f4ec0756c12310a6d6b4bb164ebe))
* add godmode indicator to hive status output (STORY-GOD-003) ([#194](https://github.com/nikrich/hungry-ghost-hive/issues/194)) ([ffc46ba](https://github.com/nikrich/hungry-ghost-hive/commit/ffc46ba82d370ca2973ddad4988848ab08ad8e58))
* add godmode indicator to TUI dashboard header ([42cc48f](https://github.com/nikrich/hungry-ghost-hive/commit/42cc48f081b2bcdfbe856316c0d4ba1b62957c25))
* add hive version command with dynamic version from package.json ([#105](https://github.com/nikrich/hungry-ghost-hive/issues/105)) ([f5a3d6a](https://github.com/nikrich/hungry-ghost-hive/commit/f5a3d6a677ccf7d6c1a73ade6cbd670d8d056f7c))
* add npm publish step to release workflow ([de0b11e](https://github.com/nikrich/hungry-ghost-hive/commit/de0b11eb60c0e4534c2fc5a5b5ea41db016ed4b3))
* Add npm publish step to release workflow (STORY-REL-004) ([047f1db](https://github.com/nikrich/hungry-ghost-hive/commit/047f1db18ab6117ee2e303e3687c9175aa10cdfc))
* add shields.io badges to README header ([ec6c476](https://github.com/nikrich/hungry-ghost-hive/commit/ec6c47668d57962df5ea28858d1fde0a050827c9))
* add shields.io badges to README header ([2e89556](https://github.com/nikrich/hungry-ghost-hive/commit/2e89556692761db2c4b95efbaa8094a82e77a235))
* add terminated agents footnote and improve agent count display ([72264db](https://github.com/nikrich/hungry-ghost-hive/commit/72264dbb308c5af0c906bfa56c11b22f5adaf02d))
* auto-close duplicate PRs when new PR submitted for same story ([#80](https://github.com/nikrich/hungry-ghost-hive/issues/80)) ([cf06c39](https://github.com/nikrich/hungry-ghost-hive/commit/cf06c39e202c6658dfba5d817c2a93fc5c6b2371))
* auto-merge approved PRs immediately on approval ([#103](https://github.com/nikrich/hungry-ghost-hive/issues/103)) ([d4b3f65](https://github.com/nikrich/hungry-ghost-hive/commit/d4b3f6535681330ad02ab4ac7e4e01dc20350ab9))
* auto-open dashboard when hive req spawns Tech Lead ([5a46d12](https://github.com/nikrich/hungry-ghost-hive/commit/5a46d12a4a77e04daaf6aa9a1e6041fd8de9f024))
* configure Vitest code coverage and enhance CI test reporting ([dfa7894](https://github.com/nikrich/hungry-ghost-hive/commit/dfa7894cbab21ad703be7c182fc73cf2dd1dd39e))
* Configure Vitest code coverage and enhance CI test reporting ([5e01ddb](https://github.com/nikrich/hungry-ghost-hive/commit/5e01ddbf52091d33cc2ca9abbfdd655776b09224))
* create typed error classes for structured error handling ([5a6a026](https://github.com/nikrich/hungry-ghost-hive/commit/5a6a026c1af79899a51105e9f36cb6c2088d7837))
* **db:** add DAO abstraction with sqlite + leveldb implementations ([146b364](https://github.com/nikrich/hungry-ghost-hive/commit/146b36410bdca9053a2034a4432ea8eb09efe24f))
* **db:** add database indexes for query performance ([2fc3b06](https://github.com/nikrich/hungry-ghost-hive/commit/2fc3b060559508f9b2ba87a5742a760dc7f9ccb3))
* distributed cluster runtime with durable raft sync and singleton leaders ([#216](https://github.com/nikrich/hungry-ghost-hive/issues/216)) ([24741fc](https://github.com/nikrich/hungry-ghost-hive/commit/24741fc98bd504f74083d3a9569ff5fa0b122d77))
* enable engineer-driven refactor stories with capacity budgeting ([#174](https://github.com/nikrich/hungry-ghost-hive/issues/174)) ([b1c549b](https://github.com/nikrich/hungry-ghost-hive/commit/b1c549b70e7b882c7b2d77d0e3befef10551b456))
* ensure agents maintain bypass permissions mode throughout lifecycle ([8002763](https://github.com/nikrich/hungry-ghost-hive/commit/800276310d28eebe80ba153de57c92b9c0bcc91b))
* **escalations:** persist dedup state and add auto-resolution ([#113](https://github.com/nikrich/hungry-ghost-hive/issues/113)) ([cf7f407](https://github.com/nikrich/hungry-ghost-hive/commit/cf7f407c545015c3df21a90bd16e128d3252438c))
* **formatting:** add Prettier for consistent code formatting ([caf9c40](https://github.com/nikrich/hungry-ghost-hive/commit/caf9c403629a6717c4f64c2560bbf973ae88dc9e))
* implement --dry-run flag for hive assign command ([163fa22](https://github.com/nikrich/hungry-ghost-hive/commit/163fa223a249dec59611a256bf2aae955187f083))
* implement --dry-run flag for hive assign command ([dd831b4](https://github.com/nikrich/hungry-ghost-hive/commit/dd831b41529cb3272f87858b1df359752c74b691))
* implement bypass mode enforcement and permission auto-approval for STORY-REF-017 ([5840e9a](https://github.com/nikrich/hungry-ghost-hive/commit/5840e9a3b9579672e7c7054fac8b6e4614a23cdf))
* implement prioritized merge queue ordering ([#107](https://github.com/nikrich/hungry-ghost-hive/issues/107)) ([9d8d1ba](https://github.com/nikrich/hungry-ghost-hive/commit/9d8d1ba72f474ba5a784abafffe88312b7d8c782))
* implement reliable message forwarding with delivery confirmation ([23133dc](https://github.com/nikrich/hungry-ghost-hive/commit/23133dc9a83be2edfff3513f2ed62a888846c174))
* make manager nudge thresholds configurable via hive.config.yaml ([c082662](https://github.com/nikrich/hungry-ghost-hive/commit/c082662b4d2045b9aa94092f5536e624ad442120))
* make QA agent scaling configurable via hive.config.yaml ([49471e1](https://github.com/nikrich/hungry-ghost-hive/commit/49471e14b4fcf03f5d785a97b898dbcbcfe798a4))
* make QA agent scaling configurable via hive.config.yaml ([aabf3bc](https://github.com/nikrich/hungry-ghost-hive/commit/aabf3bceab54bd03950227a9c57ff364bedac6f6))
* **manager:** add configurable timeouts to all shell commands ([#116](https://github.com/nikrich/hungry-ghost-hive/issues/116)) ([afcfaf8](https://github.com/nikrich/hungry-ghost-hive/commit/afcfaf84b9a295a5a0ac067a23d88429b1ff63c2))
* override all agent models to Opus 4.6 when godmode is active (STORY-GOD-002) ([6b7a8ac](https://github.com/nikrich/hungry-ghost-hive/commit/6b7a8ac4b67c46eec35787e1e1b3edac71877f57))
* require explicit story_id on PR submission and unify story ID regex ([37f7cc0](https://github.com/nikrich/hungry-ghost-hive/commit/37f7cc02b52d02e999afa3af110bdd63274795e0))
* **scheduler:** create escalation on model-cli tool compatibility mismatch ([6d850b5](https://github.com/nikrich/hungry-ghost-hive/commit/6d850b5cdd2c4bdeb795643511d246148fcda053))
* **scheduler:** detect and recover orphaned stories from terminated agents ([f118a5a](https://github.com/nikrich/hungry-ghost-hive/commit/f118a5ac4ea8fbee144d8a57ea67284adfd50b2d))
* **scheduler:** prevent multiple agents from being assigned to same story ([#106](https://github.com/nikrich/hungry-ghost-hive/issues/106)) ([0f32b60](https://github.com/nikrich/hungry-ghost-hive/commit/0f32b6084aaba37d9574ba3ea3c52eeacc3c6678))
* **scheduler:** refactor duplicated agent spawn methods into generic spawnAgent ([049eae2](https://github.com/nikrich/hungry-ghost-hive/commit/049eae2f475febeb5f386f2ba2e6defd99f0f52f))
* skip auto-merge for conflicting PRs ([9c51ddb](https://github.com/nikrich/hungry-ghost-hive/commit/9c51ddbd3c4c47f6ae3503ff98ea7488c62e1f28))
* **story-ref-015:** validate cli tool compatibility with model at spawn time ([6ce4b98](https://github.com/nikrich/hungry-ghost-hive/commit/6ce4b980737420095a779003fcda3d34a9368c61))
* **story-ref-026:** graceful qa agent scale-down - never kill agent mid-review ([009c247](https://github.com/nikrich/hungry-ghost-hive/commit/009c247570221f0f00c9a8ad4c400e4db9cb507b))
* **tests:** add comprehensive tests for orchestrator and agent modules ([6dfc166](https://github.com/nikrich/hungry-ghost-hive/commit/6dfc1669b18bf0e867bcb7a064df6827b109be19))
* track QA failure attempts per story and escalate after 3 rejections ([de3b64a](https://github.com/nikrich/hungry-ghost-hive/commit/de3b64a400ecb7ed4b63286b48990b856bd6624f))
* update default model IDs to latest Claude versions ([a551fca](https://github.com/nikrich/hungry-ghost-hive/commit/a551fca2edbbf5f065dcc522fe3efd05670209ce))
* update default model IDs to latest Claude versions ([#84](https://github.com/nikrich/hungry-ghost-hive/issues/84)) ([1161419](https://github.com/nikrich/hungry-ghost-hive/commit/1161419a3cfb4b261b10187e297aa3079ea1c395))
* wrap manager state mutations in transactions ([0968652](https://github.com/nikrich/hungry-ghost-hive/commit/09686520e9b5cdd1fa6739507748d4d27bf95f8e))


### Bug Fixes

* add .prettierignore to exclude auto-generated CHANGELOG.md ([afe9b96](https://github.com/nikrich/hungry-ghost-hive/commit/afe9b960d62ebd515f75c1d7215c2fa5bc487671))
* add godmode support to SQLite and LevelDB requirement DAOs ([461f4fd](https://github.com/nikrich/hungry-ghost-hive/commit/461f4fdef769bc917980dfedae3b039f7c72638a))
* add missing import and install eslint-config-prettier ([3606a2f](https://github.com/nikrich/hungry-ghost-hive/commit/3606a2f44624e0ab700fddfa1d053ea0fa07b1f3))
* Add missing migration 005 for last_seen column ([49264bf](https://github.com/nikrich/hungry-ghost-hive/commit/49264bfc2cfd267407544342ef9738f3ac584bed))
* add Windows PATH detection for hive CLI ([c282657](https://github.com/nikrich/hungry-ghost-hive/commit/c282657b940a4a470c4ab293804acbd21682c57a))
* **auto-merge:** add optimistic locking to prevent race conditions [STORY-REF-007] ([#125](https://github.com/nikrich/hungry-ghost-hive/issues/125)) ([1dec441](https://github.com/nikrich/hungry-ghost-hive/commit/1dec4416c68e390a26b7a8372733c704fbafb0e5))
* **auto-merge:** check GitHub PR state before attempting merge ([50a69cc](https://github.com/nikrich/hungry-ghost-hive/commit/50a69cc51fc49ffd55f25dec1c34745e8b68faf2))
* **auto-merge:** correctly map GitHub PR state to database status ([ebe79d3](https://github.com/nikrich/hungry-ghost-hive/commit/ebe79d33e2fbbdc2047e43ab2e66317ad5af4b3e))
* capture error parameters in 38 empty catch blocks across 18 files ([a22e73a](https://github.com/nikrich/hungry-ghost-hive/commit/a22e73aee38ecc75da7d55272e07a4a5f2e89978))
* change versionMap from let to const to fix linting error ([85f409b](https://github.com/nikrich/hungry-ghost-hive/commit/85f409bd4e4878d6e17dff3f32e0c41bfb89a0ae))
* change versionMap from let to const to fix linting error ([a52e0d0](https://github.com/nikrich/hungry-ghost-hive/commit/a52e0d0b2819a7dac72e8df6a73702ff9c70a10a))
* **cleanup:** replace any types with DatabaseClient ([9a38225](https://github.com/nikrich/hungry-ghost-hive/commit/9a382250736606ab62c964261c7af4238a4cd931))
* **cleanup:** replace any types with DatabaseClient for type safety ([5d440b6](https://github.com/nikrich/hungry-ghost-hive/commit/5d440b6b54f7bb618af8ac5665fc9992aafd1f78))
* correct agent count in status to include terminated agents ([6fb8d13](https://github.com/nikrich/hungry-ghost-hive/commit/6fb8d13b54d84e98653a1d75ebd6718062b321b6))
* correct areDependenciesSatisfied to only accept merged status ([7d2c307](https://github.com/nikrich/hungry-ghost-hive/commit/7d2c307c424b0fb7984efed9a0116efae0f9aafa))
* correct extractStoryIdFromBranch regex to handle branch prefixes ([bd260b2](https://github.com/nikrich/hungry-ghost-hive/commit/bd260b296740e674fa7c08f8484f3a557dd0ed47))
* correct license field from MIT to custom license ([4251ac4](https://github.com/nikrich/hungry-ghost-hive/commit/4251ac43d47fab37da3411958127b35d9883f752))
* correct license from MIT to Proprietary across README ([a1b9a08](https://github.com/nikrich/hungry-ghost-hive/commit/a1b9a08792032c30327f88784b3a9c2213462586))
* Correct license references from MIT to Proprietary ([e80ddb5](https://github.com/nikrich/hungry-ghost-hive/commit/e80ddb57c7da68867b0d76546395a58b1edfd664))
* correct TypeScript errors in scheduler.test.ts ([#186](https://github.com/nikrich/hungry-ghost-hive/issues/186)) ([229de73](https://github.com/nikrich/hungry-ghost-hive/commit/229de73791f8001acb62dfa13a999987f4a9dccd))
* correct TypeScript types in base-agent.test.ts ([#185](https://github.com/nikrich/hungry-ghost-hive/issues/185)) ([26d5755](https://github.com/nikrich/hungry-ghost-hive/commit/26d5755e9d4ba88803f295289dc2969cf5f62c9b))
* **dashboard:** add debug log rotation and document configurable refresh interval ([f659281](https://github.com/nikrich/hungry-ghost-hive/commit/f659281fd8529c38a53737d7d849c6b08ec8c280))
* **dashboard:** prevent overlapping refreshes and always show current data ([7c45012](https://github.com/nikrich/hungry-ghost-hive/commit/7c45012fecbb669fc7e4ad8332dd3effcc763c43))
* **db:** use BEGIN IMMEDIATE for all write transactions ([3ee4f51](https://github.com/nikrich/hungry-ghost-hive/commit/3ee4f51e2014bbf3932050fbb907454c94dc654d))
* **db:** use BEGIN IMMEDIATE for all write transactions [STORY-REF-001] ([d6e996c](https://github.com/nikrich/hungry-ghost-hive/commit/d6e996c7be10ab773631644f82219d38c4b393d7))
* dedupe PR sync flow and honor stuck-story config ([#229](https://github.com/nikrich/hungry-ghost-hive/issues/229)) ([d6da6ec](https://github.com/nikrich/hungry-ghost-hive/commit/d6da6ecc21581e86d15f64ee8f99c12de139110c))
* delay manager start until DB is closed to prevent race condition ([9601ebd](https://github.com/nikrich/hungry-ghost-hive/commit/9601ebdd751ad4fd714eca2e898255d03b82af53))
* deliver initial prompts via CLI arg instead of tmux send-keys ([9a8b0a5](https://github.com/nikrich/hungry-ghost-hive/commit/9a8b0a561eb0c77a3b03da0a5fed9e55fbe67f3e))
* deliver initial prompts via CLI positional argument instead of tmux send-keys ([b388d31](https://github.com/nikrich/hungry-ghost-hive/commit/b388d31c246174f92caeea60c311d94ce9a26341))
* ensure github_pr_number is populated when PRs are submitted ([#115](https://github.com/nikrich/hungry-ghost-hive/issues/115)) ([42d94ac](https://github.com/nikrich/hungry-ghost-hive/commit/42d94acbb7a90cbfe77fe5eead2f038914c76d77))
* format 3 files to restore CI ([12a4a9f](https://github.com/nikrich/hungry-ghost-hive/commit/12a4a9fc5bad310e124f006c128cc4ef33781a2e))
* format manager.ts and CHANGELOG.md with Prettier ([2f551d6](https://github.com/nikrich/hungry-ghost-hive/commit/2f551d61238dc4b14a87594578a3f12554888c82))
* format manager.ts, resume.ts, and with-hive-context.test.ts with Prettier ([b741abf](https://github.com/nikrich/hungry-ghost-hive/commit/b741abf3f9ef3fd88651497902bd03519e5b5db3))
* format story-id.test.ts with Prettier ([0dc00df](https://github.com/nikrich/hungry-ghost-hive/commit/0dc00df43c30941be4ac630d81889e7a79ebce47))
* format story-id.test.ts with Prettier ([#198](https://github.com/nikrich/hungry-ghost-hive/issues/198)) ([4ba753b](https://github.com/nikrich/hungry-ghost-hive/commit/4ba753b5c9f4c4cdb820f9fae698ff3d716a2785))
* godmode detection failing for late-spawned agents ([89a6b6a](https://github.com/nikrich/hungry-ghost-hive/commit/89a6b6aab353866f0dfe6e46b639d112983e34b4))
* godmode detection failing for late-spawned agents (e.g. QA) ([0da859a](https://github.com/nikrich/hungry-ghost-hive/commit/0da859a90564c0606db84869dd90f73c12ba555f))
* improve type safety in cleanup command by removing 'any' types ([61a2702](https://github.com/nikrich/hungry-ghost-hive/commit/61a2702481376ad56114ecc4af455d1f9f3c792c))
* include qa_failed status in QA agent scaling calculation ([1530729](https://github.com/nikrich/hungry-ghost-hive/commit/1530729a431aed2816329472b677ba75e2d04ba0))
* include refactor and perf commits in release-please changelog ([a0448ec](https://github.com/nikrich/hungry-ghost-hive/commit/a0448ecc3dde60ef6b6d260aea71718a697bc6f8))
* **logs:** add AGENT_SPAWN_FAILED event type to EventType union ([28edf0e](https://github.com/nikrich/hungry-ghost-hive/commit/28edf0e3949989f75b250001390b1cfa9a36ba7e))
* **logs:** add PR_MERGE_SKIPPED event type ([254b054](https://github.com/nikrich/hungry-ghost-hive/commit/254b054be383f9fc1b19c578a3267c0eff02629d))
* maintain backward compatibility by keeping active field in status ([809092d](https://github.com/nikrich/hungry-ghost-hive/commit/809092d81738b446114fa495be88d3fdd9ce2f25))
* **manager:** continuously enforce bypass mode on all agents ([61f3c01](https://github.com/nikrich/hungry-ghost-hive/commit/61f3c0134f08bd02996cb2d7a67d8c7bcd94c62f))
* **manager:** continuously enforce bypass mode on all agents [STORY-REF-014] ([2145eb4](https://github.com/nikrich/hungry-ghost-hive/commit/2145eb4e2315b245cb80e6fd9502faf452bff6b6))
* optimize manager daemon to eliminate N+1 queries ([64744fc](https://github.com/nikrich/hungry-ghost-hive/commit/64744fc04b381789351c177f579a065231fde823))
* populate github_pr_number when PRs are submitted ([8be832a](https://github.com/nikrich/hungry-ghost-hive/commit/8be832a511ade86b5c7a3368fd4ba9f0a8c6edab))
* populate github_pr_number when PRs are submitted ([#93](https://github.com/nikrich/hungry-ghost-hive/issues/93)) ([904a92f](https://github.com/nikrich/hungry-ghost-hive/commit/904a92f19fe983e1fa60fb79a1b6fbcb3b0d2d00))
* prettier formatting in manager.ts and pr-sync.ts ([ad97405](https://github.com/nikrich/hungry-ghost-hive/commit/ad974052503bf20b0dc9199c15e750b5e0fa8857))
* prevent manager from interrupting working agents with unassigned story notifications ([f6abf75](https://github.com/nikrich/hungry-ghost-hive/commit/f6abf75abcc1d6289d48102477b622445f2f28bf))
* properly use error variable in dashboard catch block ([ef5f29f](https://github.com/nikrich/hungry-ghost-hive/commit/ef5f29f84d4b1c3c404e1327247b0fc90459df08))
* qa scaling not counting stories in review with queued PRs ([ccd5f10](https://github.com/nikrich/hungry-ghost-hive/commit/ccd5f101a2175f61bf9d39917be75432f2dd10f4))
* reliability model godmode hardening ([#228](https://github.com/nikrich/hungry-ghost-hive/issues/228)) ([ae5b8a8](https://github.com/nikrich/hungry-ghost-hive/commit/ae5b8a865ed9d3029c296684858d450f2d109f56))
* remove unused error variable in dashboard debug logging ([f894dc3](https://github.com/nikrich/hungry-ghost-hive/commit/f894dc3981eb09546c561b5b2576b2e0e87b6f8e))
* remove unused error variable in dashboard debug logging ([4e0c08f](https://github.com/nikrich/hungry-ghost-hive/commit/4e0c08fe8c372e9168ad78c32a4030b5734ae347))
* remove unused PullRequestRow import breaking build ([2984b3e](https://github.com/nikrich/hungry-ghost-hive/commit/2984b3e2d64ce1259f76f15d9f3643b0f040c20d))
* repair broken tests from GOD-002 and FIX-001 merges ([55f2f4c](https://github.com/nikrich/hungry-ghost-hive/commit/55f2f4c6406df77b087c378b382b2da3223f8b78))
* repair broken tests from GOD-002 and FIX-001 merges ([#200](https://github.com/nikrich/hungry-ghost-hive/issues/200)) ([83d9619](https://github.com/nikrich/hungry-ghost-hive/commit/83d96192e42e8bc59f5073fda5c38e04c4c4c3e0))
* replace any type with proper GitHubPRState interface ([2cab62f](https://github.com/nikrich/hungry-ghost-hive/commit/2cab62f7d412af1fcb2b7bba93305a27fefa747c))
* replace any type with proper GitHubPRState interface ([2bc4046](https://github.com/nikrich/hungry-ghost-hive/commit/2bc404609852c408c19966092ad67449ff029c4a))
* resolve merge conflict in manager.ts imports ([071d3b3](https://github.com/nikrich/hungry-ghost-hive/commit/071d3b3597580537897d5b27e78aadbe5eacf278))
* resolve merge conflicts and remove duplicate commitlint config ([0fd0459](https://github.com/nikrich/hungry-ghost-hive/commit/0fd0459e66661b344bdd5c83d9871f3f496e754a))
* resolve sql.js DB persistence race condition with manager daemon ([#87](https://github.com/nikrich/hungry-ghost-hive/issues/87)) ([91e7cf9](https://github.com/nikrich/hungry-ghost-hive/commit/91e7cf9e230ea1bbaa7bc1a903a81592cfc81510))
* resolve TypeScript and ESLint errors in STORY-IMP-006 ([b05cf67](https://github.com/nikrich/hungry-ghost-hive/commit/b05cf67e915172ecf07b866aa39fc845ce62991f))
* resolve TypeScript error in branches.test.ts ([6d74870](https://github.com/nikrich/hungry-ghost-hive/commit/6d7487099de30e334e626f46146f1580a634e612))
* resolve TypeScript error in branches.test.ts ([64d020d](https://github.com/nikrich/hungry-ghost-hive/commit/64d020d8669486c91dc01d80f29723e312bd0f6e))
* **scheduler:** use actual cli_tool for bypass mode and remove redundant declaration ([4db78d5](https://github.com/nikrich/hungry-ghost-hive/commit/4db78d592318bda20754e940f5e374e0e3543225))
* **scheduler:** use atomic update for orphaned story recovery ([104f391](https://github.com/nikrich/hungry-ghost-hive/commit/104f391d4426a486daaa17715d2579a3ef58bed8))
* **senior:** remove delegation pattern bypassing scheduler ([f0a7708](https://github.com/nikrich/hungry-ghost-hive/commit/f0a7708474a9bdab4bbce37487a30a7ec50e8588))
* show only active agents in hive status total count ([0f20b2d](https://github.com/nikrich/hungry-ghost-hive/commit/0f20b2d856495311054b86900287bce84cf67bd9))
* show only active agents in hive status total count ([f590c77](https://github.com/nikrich/hungry-ghost-hive/commit/f590c7760247fed892960526f64dd9b231aff6e7))
* **state-detection:** improve claude-code-state detection accuracy ([#121](https://github.com/nikrich/hungry-ghost-hive/issues/121)) ([5699c34](https://github.com/nikrich/hungry-ghost-hive/commit/5699c34ac000b7791541ff40fc58861ab8637265))
* STORY-FIX-DBRACE - Delay manager start to prevent DB race condition ([8df07fd](https://github.com/nikrich/hungry-ghost-hive/commit/8df07fd4302df608a219ece1724dc556f235ce85))
* update license reference to correct Hungry Ghost Hive License ([36ef9ef](https://github.com/nikrich/hungry-ghost-hive/commit/36ef9efb117f1bc4cf9773cdc2bc1a38195542af))
* use 'json' reporter instead of 'json-summary' to generate coverage-final.json for Codecov ([ebb4ea5](https://github.com/nikrich/hungry-ghost-hive/commit/ebb4ea56286eb019f8a31dc2e8d1a328b061124f))
* use actual repo contributors from GitHub API ([#172](https://github.com/nikrich/hungry-ghost-hive/issues/172)) ([019fa40](https://github.com/nikrich/hungry-ghost-hive/commit/019fa40cb18be6afe87fd1f5dff56f28d9a8e6dd))
* use correct release-please action and remove invalid input ([6bf2ac1](https://github.com/nikrich/hungry-ghost-hive/commit/6bf2ac1505731d1b2f871ee269d0bc5818006cec))
* use prepared statements in heartbeat test to fix build ([#95](https://github.com/nikrich/hungry-ghost-hive/issues/95)) ([b1a223e](https://github.com/nikrich/hungry-ghost-hive/commit/b1a223e1fd91ebb53a40e136bc36c6568048657e))
* use release tag name for tarball upload in release workflow ([e5f1a59](https://github.com/nikrich/hungry-ghost-hive/commit/e5f1a5975b7ad5060cefd30527f0b6422eb07f70))
* use release-please manifest config for proper commit parsing ([95ec439](https://github.com/nikrich/hungry-ghost-hive/commit/95ec4391d67c226b76196de56c501e4806b89384))
* use tmux bracket paste for multi-line prompt delivery ([162b0fd](https://github.com/nikrich/hungry-ghost-hive/commit/162b0fd7f51dc1cc3f6228f78653fec81dd36e12))
* use tmux bracket paste for multi-line prompt delivery ([08174f4](https://github.com/nikrich/hungry-ghost-hive/commit/08174f4aa81c42767e52d059a59693711b832c11))


### Code Refactoring

* break up managerCheck() god function into focused helpers (STORY-REF-034) ([ef94b92](https://github.com/nikrich/hungry-ghost-hive/commit/ef94b922a3c27b9eacbd872671ab715610e348a1))
* consolidate state detector duplication into BaseStateDetector ([90efb68](https://github.com/nikrich/hungry-ghost-hive/commit/90efb68a43f6e5be40e980885a56020d1c424687))
* extract CLI boilerplate into withHiveContext wrapper ([f36b5a9](https://github.com/nikrich/hungry-ghost-hive/commit/f36b5a9765de2866cb869adfdfe6b0e4fb7efc96))
* extract CLI boilerplate into withHiveContext wrapper ([7aeb4b3](https://github.com/nikrich/hungry-ghost-hive/commit/7aeb4b3a7647d609be3d7df9d5bee942c86947b7))
* extract CLI command boilerplate into withHiveContext wrapper ([40c1d9f](https://github.com/nikrich/hungry-ghost-hive/commit/40c1d9f8870e31384116d02a3900fabb6563120b))
* extract CLI command boilerplate into withHiveContext wrapper ([8720a4b](https://github.com/nikrich/hungry-ghost-hive/commit/8720a4b60ce380d902c107491b18b11f094ac287))
* extract duplicated worktree removal and PR sync into shared utils ([bbdbe2c](https://github.com/nikrich/hungry-ghost-hive/commit/bbdbe2c3bb89d3079ac3aa8ad606fafd4c987dad))
* extract duplicated worktree removal and PR sync into shared utils ([6b7256a](https://github.com/nikrich/hungry-ghost-hive/commit/6b7256a539f66355a9f0fbecffe0d4b05122a87e))
* extract hardcoded magic numbers into named constants ([5aff4ab](https://github.com/nikrich/hungry-ghost-hive/commit/5aff4abe73316eab48a923960296ac83909544a8))
* extract prompt templates from scheduler to dedicated module ([#124](https://github.com/nikrich/hungry-ghost-hive/issues/124)) ([4c9e961](https://github.com/nikrich/hungry-ghost-hive/commit/4c9e961679285d8f539d020c584e5ff1932ab4da))
* extract worktree removal and PR sync into shared utilities ([aa4e1b2](https://github.com/nikrich/hungry-ghost-hive/commit/aa4e1b20e92a1be49567535d641a04832773e169))
* extract worktree removal and PR sync into shared utils ([ec9c5e6](https://github.com/nikrich/hungry-ghost-hive/commit/ec9c5e64273628f15cdaeca768a23206876a7b70))
* move raw SQL statements from manager.ts to db/queries layer ([a3e51cf](https://github.com/nikrich/hungry-ghost-hive/commit/a3e51cf04cd5ecfc53fd9215a2d67ec86ab4acc3))
* remove dead code — workflow.ts, scaler.ts, and unused DAO layer ([9dac2d8](https://github.com/nikrich/hungry-ghost-hive/commit/9dac2d84eebac9e32884dc9f4a87d720dbf62c95))


### Performance Improvements

* eliminate N+1 queries in dependency graph building ([b8f093f](https://github.com/nikrich/hungry-ghost-hive/commit/b8f093f27e92dfbd54d6bc99b8676c45df83fb64))
* eliminate N+1 queries in dependency graph building ([efa7af4](https://github.com/nikrich/hungry-ghost-hive/commit/efa7af4ea0eefc45e2a6945388dbd352a78eedb5))

## [0.18.2](https://github.com/nikrich/hungry-ghost-hive/compare/v0.18.1...v0.18.2) (2026-02-07)


### Bug Fixes

* add Windows PATH detection for hive CLI ([c282657](https://github.com/nikrich/hungry-ghost-hive/commit/c282657b940a4a470c4ab293804acbd21682c57a))
* use release-please manifest config for proper commit parsing ([95ec439](https://github.com/nikrich/hungry-ghost-hive/commit/95ec439))

## [0.18.1](https://github.com/nikrich/hungry-ghost-hive/compare/v0.18.0...v0.18.1) (2026-02-07)


### Bug Fixes

* delay manager start until DB is closed to prevent race condition ([9601ebd](https://github.com/nikrich/hungry-ghost-hive/commit/9601ebdd751ad4fd714eca2e898255d03b82af53))
* STORY-FIX-DBRACE - Delay manager start to prevent DB race condition ([8df07fd](https://github.com/nikrich/hungry-ghost-hive/commit/8df07fd4302df608a219ece1724dc556f235ce85))

## [0.18.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.17.2...v0.18.0) (2026-02-07)


### Features

* auto-open dashboard when hive req spawns Tech Lead ([5a46d12](https://github.com/nikrich/hungry-ghost-hive/commit/5a46d12a4a77e04daaf6aa9a1e6041fd8de9f024))

## [0.17.2](https://github.com/nikrich/hungry-ghost-hive/compare/v0.17.1...v0.17.2) (2026-02-07)


### Bug Fixes

* include refactor and perf commits in release-please changelog ([a0448ec](https://github.com/nikrich/hungry-ghost-hive/commit/a0448ecc3dde60ef6b6d260aea71718a697bc6f8))

## [0.17.1](https://github.com/nikrich/hungry-ghost-hive/compare/v0.17.0...v0.17.1) (2026-02-07)


### Bug Fixes

* add .prettierignore to exclude auto-generated CHANGELOG.md ([afe9b96](https://github.com/nikrich/hungry-ghost-hive/commit/afe9b960d62ebd515f75c1d7215c2fa5bc487671))
* format 3 files to restore CI ([12a4a9f](https://github.com/nikrich/hungry-ghost-hive/commit/12a4a9fc5bad310e124f006c128cc4ef33781a2e))
* format manager.ts and CHANGELOG.md with Prettier ([2f551d6](https://github.com/nikrich/hungry-ghost-hive/commit/2f551d61238dc4b14a87594578a3f12554888c82))
* format manager.ts, resume.ts, and with-hive-context.test.ts with Prettier ([b741abf](https://github.com/nikrich/hungry-ghost-hive/commit/b741abf3f9ef3fd88651497902bd03519e5b5db3))
* prettier formatting in manager.ts and pr-sync.ts ([ad97405](https://github.com/nikrich/hungry-ghost-hive/commit/ad974052503bf20b0dc9199c15e750b5e0fa8857))
* remove unused PullRequestRow import breaking build ([2984b3e](https://github.com/nikrich/hungry-ghost-hive/commit/2984b3e2d64ce1259f76f15d9f3643b0f040c20d))

## [0.17.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.16.0...v0.17.0) (2026-02-07)

### Features

- add godmode indicator to hive status output (STORY-GOD-003) ([#194](https://github.com/nikrich/hungry-ghost-hive/issues/194)) ([ffc46ba](https://github.com/nikrich/hungry-ghost-hive/commit/ffc46ba82d370ca2973ddad4988848ab08ad8e58))
- override all agent models to Opus 4.6 when godmode is active (STORY-GOD-002) ([6b7a8ac](https://github.com/nikrich/hungry-ghost-hive/commit/6b7a8ac4b67c46eec35787e1e1b3edac71877f57))

### Bug Fixes

- add godmode support to SQLite and LevelDB requirement DAOs ([461f4fd](https://github.com/nikrich/hungry-ghost-hive/commit/461f4fdef769bc917980dfedae3b039f7c72638a))
- correct extractStoryIdFromBranch regex to handle branch prefixes ([bd260b2](https://github.com/nikrich/hungry-ghost-hive/commit/bd260b296740e674fa7c08f8484f3a557dd0ed47))
- format story-id.test.ts with Prettier ([0dc00df](https://github.com/nikrich/hungry-ghost-hive/commit/0dc00df43c30941be4ac630d81889e7a79ebce47))
- format story-id.test.ts with Prettier ([#198](https://github.com/nikrich/hungry-ghost-hive/issues/198)) ([4ba753b](https://github.com/nikrich/hungry-ghost-hive/commit/4ba753b5c9f4c4cdb820f9fae698ff3d716a2785))
- godmode detection failing for late-spawned agents ([89a6b6a](https://github.com/nikrich/hungry-ghost-hive/commit/89a6b6aab353866f0dfe6e46b639d112983e34b4))
- godmode detection failing for late-spawned agents (e.g. QA) ([0da859a](https://github.com/nikrich/hungry-ghost-hive/commit/0da859a90564c0606db84869dd90f73c12ba555f))
- qa scaling not counting stories in review with queued PRs ([ccd5f10](https://github.com/nikrich/hungry-ghost-hive/commit/ccd5f101a2175f61bf9d39917be75432f2dd10f4))
- repair broken tests from GOD-002 and FIX-001 merges ([55f2f4c](https://github.com/nikrich/hungry-ghost-hive/commit/55f2f4c6406df77b087c378b382b2da3223f8b78))
- repair broken tests from GOD-002 and FIX-001 merges ([#200](https://github.com/nikrich/hungry-ghost-hive/issues/200)) ([83d9619](https://github.com/nikrich/hungry-ghost-hive/commit/83d96192e42e8bc59f5073fda5c38e04c4c4c3e0))

## [0.16.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.15.0...v0.16.0) (2026-02-07)

### Features

- **tests:** add comprehensive tests for orchestrator and agent modules ([6dfc166](https://github.com/nikrich/hungry-ghost-hive/commit/6dfc1669b18bf0e867bcb7a064df6827b109be19))

### Bug Fixes

- correct areDependenciesSatisfied to only accept merged status ([7d2c307](https://github.com/nikrich/hungry-ghost-hive/commit/7d2c307c424b0fb7984efed9a0116efae0f9aafa))
- correct TypeScript errors in scheduler.test.ts ([#186](https://github.com/nikrich/hungry-ghost-hive/issues/186)) ([229de73](https://github.com/nikrich/hungry-ghost-hive/commit/229de73791f8001acb62dfa13a999987f4a9dccd))
- correct TypeScript types in base-agent.test.ts ([#185](https://github.com/nikrich/hungry-ghost-hive/issues/185)) ([26d5755](https://github.com/nikrich/hungry-ghost-hive/commit/26d5755e9d4ba88803f295289dc2969cf5f62c9b))
- prevent manager from interrupting working agents with unassigned story notifications ([f6abf75](https://github.com/nikrich/hungry-ghost-hive/commit/f6abf75abcc1d6289d48102477b622445f2f28bf))

## [0.15.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.14.2...v0.15.0) (2026-02-06)

### Features

- create typed error classes for structured error handling ([5a6a026](https://github.com/nikrich/hungry-ghost-hive/commit/5a6a026c1af79899a51105e9f36cb6c2088d7837))

### Bug Fixes

- add missing import and install eslint-config-prettier ([3606a2f](https://github.com/nikrich/hungry-ghost-hive/commit/3606a2f44624e0ab700fddfa1d053ea0fa07b1f3))

## [0.14.2](https://github.com/nikrich/hungry-ghost-hive/compare/v0.14.1...v0.14.2) (2026-02-06)

### Bug Fixes

- replace any type with proper GitHubPRState interface ([2cab62f](https://github.com/nikrich/hungry-ghost-hive/commit/2cab62f7d412af1fcb2b7bba93305a27fefa747c))

## [0.14.1](https://github.com/nikrich/hungry-ghost-hive/compare/v0.14.0...v0.14.1) (2026-02-06)

### Bug Fixes

- use actual repo contributors from GitHub API ([#172](https://github.com/nikrich/hungry-ghost-hive/issues/172)) ([019fa40](https://github.com/nikrich/hungry-ghost-hive/commit/019fa40cb18be6afe87fd1f5dff56f28d9a8e6dd))

## [0.14.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.13.1...v0.14.0) (2026-02-06)

### Features

- add GitHub PR template, issue templates, and CODE_OF_CONDUCT ([#167](https://github.com/nikrich/hungry-ghost-hive/issues/167)) ([b465148](https://github.com/nikrich/hungry-ghost-hive/commit/b465148c7cd4f4ec0756c12310a6d6b4bb164ebe))

## [0.13.1](https://github.com/nikrich/hungry-ghost-hive/compare/v0.13.0...v0.13.1) (2026-02-06)

### Bug Fixes

- correct license from MIT to Proprietary across README ([a1b9a08](https://github.com/nikrich/hungry-ghost-hive/commit/a1b9a08792032c30327f88784b3a9c2213462586))
- Correct license references from MIT to Proprietary ([e80ddb5](https://github.com/nikrich/hungry-ghost-hive/commit/e80ddb57c7da68867b0d76546395a58b1edfd664))

## [0.13.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.12.0...v0.13.0) (2026-02-06)

### Features

- **db:** add DAO abstraction with sqlite + leveldb implementations ([146b364](https://github.com/nikrich/hungry-ghost-hive/commit/146b36410bdca9053a2034a4432ea8eb09efe24f))

## [0.12.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.11.1...v0.12.0) (2026-02-06)

### Features

- Configure Vitest code coverage and enhance CI test reporting ([5e01ddb](https://github.com/nikrich/hungry-ghost-hive/commit/5e01ddbf52091d33cc2ca9abbfdd655776b09224))

## [0.11.1](https://github.com/nikrich/hungry-ghost-hive/compare/v0.11.0...v0.11.1) (2026-02-06)

### Bug Fixes

- resolve TypeScript error in branches.test.ts ([6d74870](https://github.com/nikrich/hungry-ghost-hive/commit/6d7487099de30e334e626f46146f1580a634e612))

## [0.11.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.10.3...v0.11.0) (2026-02-06)

### Features

- add shields.io badges to README header ([2e89556](https://github.com/nikrich/hungry-ghost-hive/commit/2e89556692761db2c4b95efbaa8094a82e77a235))

## [0.10.3](https://github.com/nikrich/hungry-ghost-hive/compare/v0.10.2...v0.10.3) (2026-02-06)

### Bug Fixes

- deliver initial prompts via CLI arg instead of tmux send-keys ([9a8b0a5](https://github.com/nikrich/hungry-ghost-hive/commit/9a8b0a561eb0c77a3b03da0a5fed9e55fbe67f3e))
- deliver initial prompts via CLI positional argument instead of tmux send-keys ([b388d31](https://github.com/nikrich/hungry-ghost-hive/commit/b388d31c246174f92caeea60c311d94ce9a26341))

## [0.10.2](https://github.com/nikrich/hungry-ghost-hive/compare/v0.10.1...v0.10.2) (2026-02-06)

### Bug Fixes

- **manager:** continuously enforce bypass mode on all agents [STORY-REF-014] ([2145eb4](https://github.com/nikrich/hungry-ghost-hive/commit/2145eb4e2315b245cb80e6fd9502faf452bff6b6))
- resolve merge conflict in manager.ts imports ([071d3b3](https://github.com/nikrich/hungry-ghost-hive/commit/071d3b3597580537897d5b27e78aadbe5eacf278))

## [0.10.1](https://github.com/nikrich/hungry-ghost-hive/compare/v0.10.0...v0.10.1) (2026-02-06)

### Bug Fixes

- use tmux bracket paste for multi-line prompt delivery ([162b0fd](https://github.com/nikrich/hungry-ghost-hive/commit/162b0fd7f51dc1cc3f6228f78653fec81dd36e12))
- use tmux bracket paste for multi-line prompt delivery ([08174f4](https://github.com/nikrich/hungry-ghost-hive/commit/08174f4aa81c42767e52d059a59693711b832c11))

## [0.10.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.9.0...v0.10.0) (2026-02-06)

### Features

- add terminated agents footnote and improve agent count display ([72264db](https://github.com/nikrich/hungry-ghost-hive/commit/72264dbb308c5af0c906bfa56c11b22f5adaf02d))
- ensure agents maintain bypass permissions mode throughout lifecycle ([8002763](https://github.com/nikrich/hungry-ghost-hive/commit/800276310d28eebe80ba153de57c92b9c0bcc91b))
- implement bypass mode enforcement and permission auto-approval for STORY-REF-017 ([5840e9a](https://github.com/nikrich/hungry-ghost-hive/commit/5840e9a3b9579672e7c7054fac8b6e4614a23cdf))
- require explicit story_id on PR submission and unify story ID regex ([37f7cc0](https://github.com/nikrich/hungry-ghost-hive/commit/37f7cc02b52d02e999afa3af110bdd63274795e0))
- **scheduler:** create escalation on model-cli tool compatibility mismatch ([6d850b5](https://github.com/nikrich/hungry-ghost-hive/commit/6d850b5cdd2c4bdeb795643511d246148fcda053))
- **scheduler:** detect and recover orphaned stories from terminated agents ([f118a5a](https://github.com/nikrich/hungry-ghost-hive/commit/f118a5ac4ea8fbee144d8a57ea67284adfd50b2d))
- skip auto-merge for conflicting PRs ([9c51ddb](https://github.com/nikrich/hungry-ghost-hive/commit/9c51ddbd3c4c47f6ae3503ff98ea7488c62e1f28))
- **story-ref-015:** validate cli tool compatibility with model at spawn time ([6ce4b98](https://github.com/nikrich/hungry-ghost-hive/commit/6ce4b980737420095a779003fcda3d34a9368c61))
- track QA failure attempts per story and escalate after 3 rejections ([de3b64a](https://github.com/nikrich/hungry-ghost-hive/commit/de3b64a400ecb7ed4b63286b48990b856bd6624f))
- wrap manager state mutations in transactions ([0968652](https://github.com/nikrich/hungry-ghost-hive/commit/09686520e9b5cdd1fa6739507748d4d27bf95f8e))

### Bug Fixes

- **auto-merge:** check GitHub PR state before attempting merge ([50a69cc](https://github.com/nikrich/hungry-ghost-hive/commit/50a69cc51fc49ffd55f25dec1c34745e8b68faf2))
- **auto-merge:** correctly map GitHub PR state to database status ([ebe79d3](https://github.com/nikrich/hungry-ghost-hive/commit/ebe79d33e2fbbdc2047e43ab2e66317ad5af4b3e))
- **cleanup:** replace any types with DatabaseClient ([9a38225](https://github.com/nikrich/hungry-ghost-hive/commit/9a382250736606ab62c964261c7af4238a4cd931))
- **cleanup:** replace any types with DatabaseClient for type safety ([5d440b6](https://github.com/nikrich/hungry-ghost-hive/commit/5d440b6b54f7bb618af8ac5665fc9992aafd1f78))
- improve type safety in cleanup command by removing 'any' types ([61a2702](https://github.com/nikrich/hungry-ghost-hive/commit/61a2702481376ad56114ecc4af455d1f9f3c792c))
- **logs:** add AGENT_SPAWN_FAILED event type to EventType union ([28edf0e](https://github.com/nikrich/hungry-ghost-hive/commit/28edf0e3949989f75b250001390b1cfa9a36ba7e))
- **logs:** add PR_MERGE_SKIPPED event type ([254b054](https://github.com/nikrich/hungry-ghost-hive/commit/254b054be383f9fc1b19c578a3267c0eff02629d))
- maintain backward compatibility by keeping active field in status ([809092d](https://github.com/nikrich/hungry-ghost-hive/commit/809092d81738b446114fa495be88d3fdd9ce2f25))
- properly use error variable in dashboard catch block ([ef5f29f](https://github.com/nikrich/hungry-ghost-hive/commit/ef5f29f84d4b1c3c404e1327247b0fc90459df08))
- remove unused error variable in dashboard debug logging ([f894dc3](https://github.com/nikrich/hungry-ghost-hive/commit/f894dc3981eb09546c561b5b2576b2e0e87b6f8e))
- remove unused error variable in dashboard debug logging ([4e0c08f](https://github.com/nikrich/hungry-ghost-hive/commit/4e0c08fe8c372e9168ad78c32a4030b5734ae347))
- **scheduler:** use actual cli_tool for bypass mode and remove redundant declaration ([4db78d5](https://github.com/nikrich/hungry-ghost-hive/commit/4db78d592318bda20754e940f5e374e0e3543225))
- **scheduler:** use atomic update for orphaned story recovery ([104f391](https://github.com/nikrich/hungry-ghost-hive/commit/104f391d4426a486daaa17715d2579a3ef58bed8))
- show only active agents in hive status total count ([0f20b2d](https://github.com/nikrich/hungry-ghost-hive/commit/0f20b2d856495311054b86900287bce84cf67bd9))
- show only active agents in hive status total count ([f590c77](https://github.com/nikrich/hungry-ghost-hive/commit/f590c7760247fed892960526f64dd9b231aff6e7))

## [0.9.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.8.0...v0.9.0) (2026-02-06)

### Features

- add comprehensive tests for immediate auto-merge functionality ([#117](https://github.com/nikrich/hungry-ghost-hive/issues/117)) ([2299f48](https://github.com/nikrich/hungry-ghost-hive/commit/2299f4835eede6cce6eb882fe87e0beaefacaf24))
- **escalations:** persist dedup state and add auto-resolution ([#113](https://github.com/nikrich/hungry-ghost-hive/issues/113)) ([cf7f407](https://github.com/nikrich/hungry-ghost-hive/commit/cf7f407c545015c3df21a90bd16e128d3252438c))
- implement reliable message forwarding with delivery confirmation ([23133dc](https://github.com/nikrich/hungry-ghost-hive/commit/23133dc9a83be2edfff3513f2ed62a888846c174))
- **manager:** add configurable timeouts to all shell commands ([#116](https://github.com/nikrich/hungry-ghost-hive/issues/116)) ([afcfaf8](https://github.com/nikrich/hungry-ghost-hive/commit/afcfaf84b9a295a5a0ac067a23d88429b1ff63c2))

### Bug Fixes

- **dashboard:** add debug log rotation and document configurable refresh interval ([f659281](https://github.com/nikrich/hungry-ghost-hive/commit/f659281fd8529c38a53737d7d849c6b08ec8c280))
- **dashboard:** prevent overlapping refreshes and always show current data ([7c45012](https://github.com/nikrich/hungry-ghost-hive/commit/7c45012fecbb669fc7e4ad8332dd3effcc763c43))
- **db:** use BEGIN IMMEDIATE for all write transactions ([3ee4f51](https://github.com/nikrich/hungry-ghost-hive/commit/3ee4f51e2014bbf3932050fbb907454c94dc654d))
- **db:** use BEGIN IMMEDIATE for all write transactions [STORY-REF-001] ([d6e996c](https://github.com/nikrich/hungry-ghost-hive/commit/d6e996c7be10ab773631644f82219d38c4b393d7))
- ensure github_pr_number is populated when PRs are submitted ([#115](https://github.com/nikrich/hungry-ghost-hive/issues/115)) ([42d94ac](https://github.com/nikrich/hungry-ghost-hive/commit/42d94acbb7a90cbfe77fe5eead2f038914c76d77))
- **state-detection:** improve claude-code-state detection accuracy ([#121](https://github.com/nikrich/hungry-ghost-hive/issues/121)) ([5699c34](https://github.com/nikrich/hungry-ghost-hive/commit/5699c34ac000b7791541ff40fc58861ab8637265))

## [0.8.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.7.0...v0.8.0) (2026-02-06)

### Features

- add hive version command with dynamic version from package.json ([#105](https://github.com/nikrich/hungry-ghost-hive/issues/105)) ([f5a3d6a](https://github.com/nikrich/hungry-ghost-hive/commit/f5a3d6a677ccf7d6c1a73ade6cbd670d8d056f7c))
- implement prioritized merge queue ordering ([#107](https://github.com/nikrich/hungry-ghost-hive/issues/107)) ([9d8d1ba](https://github.com/nikrich/hungry-ghost-hive/commit/9d8d1ba72f474ba5a784abafffe88312b7d8c782))
- **scheduler:** prevent multiple agents from being assigned to same story ([#106](https://github.com/nikrich/hungry-ghost-hive/issues/106)) ([0f32b60](https://github.com/nikrich/hungry-ghost-hive/commit/0f32b6084aaba37d9574ba3ea3c52eeacc3c6678))

## [0.7.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.6.3...v0.7.0) (2026-02-06)

### Features

- auto-merge approved PRs immediately on approval ([#103](https://github.com/nikrich/hungry-ghost-hive/issues/103)) ([d4b3f65](https://github.com/nikrich/hungry-ghost-hive/commit/d4b3f6535681330ad02ab4ac7e4e01dc20350ab9))

## [0.6.3](https://github.com/nikrich/hungry-ghost-hive/compare/v0.6.2...v0.6.3) (2026-02-06)

### Bug Fixes

- populate github_pr_number when PRs are submitted ([8be832a](https://github.com/nikrich/hungry-ghost-hive/commit/8be832a511ade86b5c7a3368fd4ba9f0a8c6edab))

### Performance Improvements

- eliminate N+1 queries in dependency graph building ([b8f093f](https://github.com/nikrich/hungry-ghost-hive/commit/b8f093f27e92dfbd54d6bc99b8676c45df83fb64))
- eliminate N+1 queries in dependency graph building ([efa7af4](https://github.com/nikrich/hungry-ghost-hive/commit/efa7af4ea0eefc45e2a6945388dbd352a78eedb5))

## [0.6.2](https://github.com/nikrich/hungry-ghost-hive/compare/v0.6.1...v0.6.2) (2026-02-06)

### Bug Fixes

- populate github_pr_number when PRs are submitted ([#93](https://github.com/nikrich/hungry-ghost-hive/issues/93)) ([904a92f](https://github.com/nikrich/hungry-ghost-hive/commit/904a92f19fe983e1fa60fb79a1b6fbcb3b0d2d00))

## [0.6.1](https://github.com/nikrich/hungry-ghost-hive/compare/v0.6.0...v0.6.1) (2026-02-06)

### Bug Fixes

- use prepared statements in heartbeat test to fix build ([#95](https://github.com/nikrich/hungry-ghost-hive/issues/95)) ([b1a223e](https://github.com/nikrich/hungry-ghost-hive/commit/b1a223e1fd91ebb53a40e136bc36c6568048657e))

## [0.6.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.5.0...v0.6.0) (2026-02-06)

### Features

- auto-close duplicate PRs when new PR submitted for same story ([#80](https://github.com/nikrich/hungry-ghost-hive/issues/80)) ([cf06c39](https://github.com/nikrich/hungry-ghost-hive/commit/cf06c39e202c6658dfba5d817c2a93fc5c6b2371))
- implement --dry-run flag for hive assign command ([163fa22](https://github.com/nikrich/hungry-ghost-hive/commit/163fa223a249dec59611a256bf2aae955187f083))
- implement --dry-run flag for hive assign command ([dd831b4](https://github.com/nikrich/hungry-ghost-hive/commit/dd831b41529cb3272f87858b1df359752c74b691))
- update default model IDs to latest Claude versions ([#84](https://github.com/nikrich/hungry-ghost-hive/issues/84)) ([1161419](https://github.com/nikrich/hungry-ghost-hive/commit/1161419a3cfb4b261b10187e297aa3079ea1c395))

## [0.5.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.4.1...v0.5.0) (2026-02-06)

### Features

- make QA agent scaling configurable via hive.config.yaml ([49471e1](https://github.com/nikrich/hungry-ghost-hive/commit/49471e14b4fcf03f5d785a97b898dbcbcfe798a4))

## [0.4.1](https://github.com/nikrich/hungry-ghost-hive/compare/v0.4.0...v0.4.1) (2026-02-06)

### Bug Fixes

- optimize manager daemon to eliminate N+1 queries ([64744fc](https://github.com/nikrich/hungry-ghost-hive/commit/64744fc04b381789351c177f579a065231fde823))

## [0.4.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.3.1...v0.4.0) (2026-02-06)

### Features

- add comprehensive cleanup command for orphaned resources ([7013aa2](https://github.com/nikrich/hungry-ghost-hive/commit/7013aa29d8c45da023f4fa389e59736b3bb25e35))
- **db:** add database indexes for query performance ([2fc3b06](https://github.com/nikrich/hungry-ghost-hive/commit/2fc3b060559508f9b2ba87a5742a760dc7f9ccb3))
- **scheduler:** refactor duplicated agent spawn methods into generic spawnAgent ([049eae2](https://github.com/nikrich/hungry-ghost-hive/commit/049eae2f475febeb5f386f2ba2e6defd99f0f52f))
- update default model IDs to latest Claude versions ([a551fca](https://github.com/nikrich/hungry-ghost-hive/commit/a551fca2edbbf5f065dcc522fe3efd05670209ce))

### Bug Fixes

- change versionMap from let to const to fix linting error ([85f409b](https://github.com/nikrich/hungry-ghost-hive/commit/85f409bd4e4878d6e17dff3f32e0c41bfb89a0ae))
- change versionMap from let to const to fix linting error ([a52e0d0](https://github.com/nikrich/hungry-ghost-hive/commit/a52e0d0b2819a7dac72e8df6a73702ff9c70a10a))

## [0.3.1](https://github.com/nikrich/hungry-ghost-hive/compare/v0.3.0...v0.3.1) (2026-02-06)

### Bug Fixes

- correct license field from MIT to custom license ([4251ac4](https://github.com/nikrich/hungry-ghost-hive/commit/4251ac43d47fab37da3411958127b35d9883f752))
- use release tag name for tarball upload in release workflow ([e5f1a59](https://github.com/nikrich/hungry-ghost-hive/commit/e5f1a5975b7ad5060cefd30527f0b6422eb07f70))

## [0.3.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.2.0...v0.3.0) (2026-02-06)

### Features

- add npm publish step to release workflow ([de0b11e](https://github.com/nikrich/hungry-ghost-hive/commit/de0b11eb60c0e4534c2fc5a5b5ea41db016ed4b3))
- Add npm publish step to release workflow (STORY-REL-004) ([047f1db](https://github.com/nikrich/hungry-ghost-hive/commit/047f1db18ab6117ee2e303e3687c9175aa10cdfc))

## [0.2.0](https://github.com/nikrich/hungry-ghost-hive/compare/v0.1.4...v0.2.0) (2026-02-06)

### Features

- add commitlint and husky for conventional commit enforcement ([71bbb11](https://github.com/nikrich/hungry-ghost-hive/commit/71bbb11654e8c983d925debad886a161e8726934))
- add conventional commit enforcement with commitlint and husky ([887c915](https://github.com/nikrich/hungry-ghost-hive/commit/887c9150da17dda55c7f574649d99f8e1678273d))

### Bug Fixes

- Add missing migration 005 for last_seen column ([49264bf](https://github.com/nikrich/hungry-ghost-hive/commit/49264bfc2cfd267407544342ef9738f3ac584bed))
- resolve merge conflicts and remove duplicate commitlint config ([0fd0459](https://github.com/nikrich/hungry-ghost-hive/commit/0fd0459e66661b344bdd5c83d9871f3f496e754a))
- use correct release-please action and remove invalid input ([6bf2ac1](https://github.com/nikrich/hungry-ghost-hive/commit/6bf2ac1505731d1b2f871ee269d0bc5818006cec))
