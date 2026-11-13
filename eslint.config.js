import globals from 'globals'
import base from '@jakobmelchard/config/eslint'

export default [
  ...base,
  // src/ runs in the Workers runtime; its tests on Node.
  { languageOptions: { globals: { ...globals.node, ...globals.serviceworker } } },
  {
    rules: {
      // tsc checks the types; a description only where the name does not say it
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-property-description': 'off',
      'jsdoc/require-returns-description': 'off',
    },
  },
]
