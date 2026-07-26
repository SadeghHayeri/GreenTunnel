// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/release/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
    ],
  },

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Node-style callbacks and event handlers legitimately return void promises.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false, attributes: false } },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // CLI and logger write to stdout/stderr by design.
  {
    files: ['packages/cli/src/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  // The engine lives in `packages/cli/src/core` and used to be its own package,
  // which made this structural: it simply could not reach the CLI. A directory
  // guarantees nothing, so the boundary is enforced here instead. The engine is
  // also consumed by `apps/desktop`, where `parseArgs`, `styleText` and
  // `process.exit` have no business being.
  {
    files: ['packages/cli/src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/main.js', '**/options.js', '**/ui.js', '**/version.js'],
              message:
                'The engine must not import the CLI. Everything under src/core has to stand alone — apps/desktop bundles it without any of the terminal code.',
            },
          ],
        },
      ],
    },
  },

  // Repository scripts are plain Node ESM, outside every TS project — so they get
  // no Node globals from a lib the way the .ts files do.
  {
    files: ['scripts/**/*.js'],
    languageOptions: { globals: globals.node },
  },

  // Renderer runs in the browser, not Node.
  {
    files: ['apps/desktop/src/renderer/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },

  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
