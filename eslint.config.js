export default [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      'build/**',
      'outputs/**',
      'artifacts/**',
      'profiles/**',
      'playwright-report/**',
      'test-results/**',
      'tmp/**',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'curly': ['error', 'all'],
      'eqeqeq': ['error', 'always'],
      'no-constant-binary-expression': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-var': 'error',
      'object-shorthand': ['warn', 'always'],
      'prefer-const': ['warn', { destructuring: 'all' }],
    },
  },
  {
    files: [
      'main.js',
      'cli/**/*.js',
      'automation/**/*.js',
      'builder/**/*.js',
      'config/**/*.js',
      'core/**/*.js',
      'drafts/**/*.js',
      'hcl/**/*.js',
      'tests/**/*.js',
    ],
    languageOptions: {
      globals: {
        URL: 'readonly',
        console: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    files: ['extension/**/*.js'],
    languageOptions: {
      globals: {
        Blob: 'readonly',
        URL: 'readonly',
        chrome: 'readonly',
        console: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        setTimeout: 'readonly',
        window: 'readonly',
      },
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        afterEach: 'readonly',
        beforeEach: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        vi: 'readonly',
      },
    },
  },
];
