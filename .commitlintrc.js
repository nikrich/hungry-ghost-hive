export default {
  extends: ['@commitlint/config-conventional'],
  parserPreset: {
    name: 'conventional-changelog-conventionalcommits',
    path: 'conventional-changelog-conventionalcommits',
    parserOpts: {
      // Match both STORY-TYPE-NUMBER and conventional formats
      // STORY-FIX-005: message or feat(scope): message
      headerPattern: /^([\w-]+)(?:\(\w+\))?!?:\s(.+)$/,
      breakingHeaderPattern: /^([\w-]+)(?:\(\w+\))?!:\s(.+)$/,
      headerCorrespondence: ['type', 'subject'],
      issuePrefixes: ['#'],
    },
  },
  rules: {
    'type-enum': [0], // Disable strict type checking
    'type-case': [0], // Allow both lowercase and UPPERCASE
    'subject-case': [0], // Allow any case in subject
    'subject-full-stop': [0], // Optional full stop
    'scope-enum': [0], // No scope validation
    'type-empty': [2, 'never'],
    'subject-empty': [2, 'never'],
  },
};
