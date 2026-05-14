import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// pdfjs-dist ≥ 5.7 uses Map.prototype.getOrInsertComputed (TC39 proposal,
// available in Chrome 136+ / Firefox 135+ / Node 24+). Polyfill it for
// older browsers so PDF loading doesn't throw at runtime.
if (!('getOrInsertComputed' in Map.prototype)) {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    configurable: true,
    writable: true,
    value<K, V>(this: Map<K, V>, key: K, callbackfn: (key: K) => V): V {
      if (!this.has(key)) this.set(key, callbackfn(key));
      return this.get(key) as V;
    },
  });
}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
