'use strict';

const { err } = require('./errors');

/** "/api/wallet/deposits/" -> "/wallet/deposits"; the Hosting rewrite keeps the /api prefix, direct calls do not. */
function normalizePath(rawPath) {
  let path = String(rawPath || '/').split('?')[0];
  path = path.replace(/^\/api(?=\/|$)/, '');
  path = path.replace(/\/+$/, '');
  return path === '' ? '/' : path;
}

class Router {
  constructor() {
    this.routes = [];
  }

  /** pattern like "/wallet/deposits/:id/sync" */
  add(method, pattern, options, handler) {
    const keys = [];
    const source = pattern.replace(/:([A-Za-z]+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
    this.routes.push({ method, pattern, regex: new RegExp(`^${source}$`), keys, options, handler });
  }

  match(method, rawPath) {
    const path = normalizePath(rawPath);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const found = route.regex.exec(path);
      if (!found) continue;
      const params = {};
      try {
        route.keys.forEach((key, index) => {
          params[key] = decodeURIComponent(found[index + 1]);
        });
      } catch {
        throw err('invalid_argument', 'Malformed URL.');
      }
      return { route, params };
    }
    return null;
  }
}

module.exports = { Router, normalizePath };
