import vm from 'node:vm';

export function appHarness(html) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', innerHTML: '', value: '', dataset: {}, style: {}, open: false,
      classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {}, addEventListener() {},
      closest() { return this; }, querySelector() { return element('nested'); }, querySelectorAll() { return []; },
      showModal() { this.open = true; }, close() { this.open = false; }, focus() {},
    });
    return elements.get(id);
  };
  for (const match of html.matchAll(/<script[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/script>/g)) element(match[1]).textContent = match[2];
  const context = vm.createContext({
    document: { getElementById: element, querySelector: () => ({ content: 'https://api.example/api/history' }), querySelectorAll: () => [], addEventListener() {} },
    window: { print() {}, addEventListener() {} }, navigator: {}, location: { href: 'https://lawcombo.github.io/kiosk-order/' },
    console, Intl, Date, URL, Blob, AbortController, TextEncoder, TextDecoder, crypto: globalThis.crypto,
    structuredClone, setTimeout: () => 0, clearTimeout() {}, confirm: () => true,
    fetch: async () => { throw new Error('Offline test'); },
  });
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) if (!match[1].includes('application/json')) vm.runInContext(match[2], context);
  return { context, run: expression => vm.runInContext(expression, context), json: expression => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context)) };
}
