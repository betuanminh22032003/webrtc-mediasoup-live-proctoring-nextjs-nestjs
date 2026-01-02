/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'prettier',
  ],
  rules: {
    // Enforce explicit return types for better documentation
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/explicit-module-boundary-types': 'warn',

    // Prevent floating promises (critical for async WebRTC operations)
    '@typescript-eslint/no-floating-promises': 'error',

    // Enforce proper error handling
    '@typescript-eslint/no-misused-promises': 'error',

    // No magic numbers - critical for RTC configuration
    'no-magic-numbers': [
      'warn',
      {
        ignore: [0, 1, -1],
        ignoreArrayIndexes: true,
        enforceConst: true,
      },
    ],

    // Require explicit any declarations
    '@typescript-eslint/no-explicit-any': 'error',

    // Consistent type imports
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports' },
    ],

    // No unused vars (allow underscore prefix for intentionally unused)
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
  overrides: [
    {
      // Relax rules for config files
      files: ['*.config.{js,ts}', '.eslintrc.js'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
        'no-magic-numbers': 'off',
      },
    },
  ],
  ignorePatterns: ['dist', 'node_modules', '.next', 'coverage'],
};
