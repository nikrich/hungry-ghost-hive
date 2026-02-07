// Licensed under the Hungry Ghost Hive License. See LICENSE.

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [0, 'never'],
  },
  parserPreset: {
    parserOpts: {
      // This pattern ensures STORY-* references are allowed in the subject/body
      // but NOT as the commit type prefix
      issuePrefixes: ['STORY-'],
    },
  },
};
