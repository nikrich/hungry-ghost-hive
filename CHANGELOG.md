# Changelog

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
