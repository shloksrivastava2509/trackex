import next from 'eslint-config-next';

const config = [
  ...next,
  { ignores: ['.next/**', 'node_modules/**', 'src/**', 'dist/**', 'scripts/**', 'paste-ready/**', 'test/trackex.test.js', 'drizzle/**'] }
];

export default config;
