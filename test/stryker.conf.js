/**
 * @type {import('@stryker-mutator/api/core').StrykerOptions}
 */
module.exports = {
  packageManager: 'yarn',
  reporters: ['html', 'clear-text', 'progress'],
  testRunner: 'mocha',
  coverageAnalysis: 'perTest',
  mutate: [ 'src/plimsoll.js' ],
};
