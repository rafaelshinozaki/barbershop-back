module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended'
  ],
  root: true,
  env: {
    node: true,
    jest: true
  },
  ignorePatterns: ['.eslintrc.js'],
  overrides: [
    {
      // Nos testes, `!` depois de achar o registro é o jeito direto de dizer
      // "tem que existir" (se não existir, o teste falha do mesmo jeito)
      files: ['*.spec.ts', 'test/**/*.ts'],
      rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
    },
  ],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    // Omitir campo por desestruturação (`const { password: _pw, ...rest }`)
    // e parâmetros/variáveis com prefixo "_" são intencionais
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  }
};
