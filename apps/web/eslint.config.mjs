import coreWebVitals from 'eslint-config-next/core-web-vitals';

const eslintConfig = [
  ...coreWebVitals,
  {
    rules: {
      // Tracked follow-up: requires refactoring effect-based initialization
      // (auth/project/paper contexts) to the React 19 idioms across many components.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'out/**'],
  },
];

export default eslintConfig;
