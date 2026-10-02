// Single place for the project's outward links and version, so the footer,
// and anything else that needs them, never hardcode a URL.
import pkg from '../../package.json';

export const about = {
  version: pkg.version,
  repo: 'https://github.com/awall451/gantry',
  support: 'https://ko-fi.com/sigilworks',
  license: 'MIT',
};
