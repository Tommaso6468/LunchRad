// @ts-check
import eslint from '@eslint/js';
import angular from 'angular-eslint';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.angular/**',
      '**/.wrangler/**',
      '**/coverage/**',
      'worker/worker-configuration.d.ts',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.strict,
      ...tseslint.configs.stylistic,
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='random'][object.name='Math']",
          message: 'Use crypto.getRandomValues: Math.random is predictable.',
        },
      ],
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Raw HTML is banned (XSS). Bind text instead.' },
        { property: 'outerHTML', message: 'Raw HTML is banned (XSS). Bind text instead.' },
        { property: 'insertAdjacentHTML', message: 'Raw HTML is banned (XSS).' },
      ],
      // Angular components are decorated classes and may have no members.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['app/**/*.ts'],
    extends: [...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
    },
  },
  {
    files: ['app/**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.mjs'],
    extends: [eslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
);
