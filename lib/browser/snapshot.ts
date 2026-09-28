import type { Observation, Operation } from '../agent/types.ts';

/** Serialized and evaluated in the page. Keep this function self-contained. */
export function readPage(): Observation {
  type Cache = { ids: WeakMap<HTMLElement, string>; nodes: Map<string, HTMLElement>; next: number; documentId: string };
  const win = window as unknown as { __playwrightJev?: Cache };
  const cache = win.__playwrightJev ??= { ids: new WeakMap(), nodes: new Map(), next: 1, documentId: String(performance.timeOrigin) };
  for (const [id, node] of cache.nodes) if (!node.isConnected) cache.nodes.delete(id);
  const identity = (node: HTMLElement) => {
    let id = cache.ids.get(node);
    if (!id) { id = String(cache.next++); cache.ids.set(node, id); }
    cache.nodes.set(id, node); return id;
  };
  const visible = (node: HTMLElement) => {
    const rect = node.getBoundingClientRect();
    return !node.closest('[aria-hidden="true"],[inert]') && node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
      rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  };
  const label = (node: HTMLElement) => {
    const labelled = (node.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim();
    const labels = 'labels' in node ? Array.from((node as HTMLInputElement).labels ?? []).map(n => n.textContent).join(' ') : '';
    return (labelled || node.getAttribute('aria-label') || labels || node.getAttribute('placeholder') || node.innerText || node.getAttribute('title') || node.getAttribute('alt') || '').trim().slice(0, 400);
  };
  const role = (node: HTMLElement) => node.getAttribute('role') ||
    (node.tagName === 'SELECT' ? 'combobox' : node.matches('textarea,[contenteditable="true"],input:not([type]),input[type="text"],input[type="email"],input[type="search"],input[type="number"]') ? 'textbox' :
      node.matches('input[type="checkbox"],input[type="radio"]') ? (node as HTMLInputElement).type : node.tagName === 'A' ? 'link' : 'button');
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('body *'));
  const elements: Observation['elements'] = [];
  for (const node of nodes) {
    const native = node.matches('button,a[href],input,textarea,select,summary,[contenteditable="true"],[role="button"],[role="option"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="combobox"]');
    // Drag handles can expose an entire panel as a button. Prefer its actual controls.
    if (node.getAttribute('role') === 'button' && node.querySelector('input,textarea,select,button,a[href]')) continue;
    // Prefer the deepest named pointer surface. Clicks bubble to React div handlers,
    // including nested controls whose cursor is inherited from a surrounding panel.
    const pointer = getComputedStyle(node).cursor === 'pointer' && !Array.from(node.children).some(child =>
      child instanceof HTMLElement && visible(child) && getComputedStyle(child).cursor === 'pointer' && label(child));
    if ((!native && !pointer) || !visible(node) || node.matches(':disabled,input[type="password"],input[type="file"],input[type="hidden"]') || node.closest('[aria-disabled="true"]')) continue;
    const id = identity(node), name = label(node);
    if (!name && !native) continue;
    const value = 'value' in node ? String((node as HTMLInputElement).value) : node.isContentEditable ? node.innerText : '';
    const editable = node.matches('textarea,[contenteditable="true"],input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="number"],input[type="url"],input[type="tel"]') && !(node as HTMLInputElement).readOnly && node.getAttribute('aria-readonly') !== 'true';
    const operations: Operation[] = node.tagName === 'SELECT' ? ['SELECT'] : editable ? ['CLICK', 'TYPE_TEXT', 'PRESS_ENTER'] : ['CLICK'];
    const options = node.tagName === 'SELECT' ? Array.from((node as HTMLSelectElement).options).filter(o => !o.disabled && !o.closest('optgroup[disabled]')).map((o, index) => ({ id: `${id}:${index + 1}`, label: o.label, value: o.value })) : undefined;
    const checked = node.matches('input[type="checkbox"],input[type="radio"]') ? (node as HTMLInputElement).checked : node.hasAttribute('aria-checked') ? node.getAttribute('aria-checked') === 'true' : undefined;
    const scope = node.closest('form,dialog,[role="dialog"],li,tr') ?? node.parentElement;
    const guard = JSON.stringify([id, name, value, checked, options, node.getAttribute('href'), node.getAttribute('aria-expanded'), scope?.textContent?.slice(0, 4000)]);
    elements.push({ id, role: role(node), label: name || role(node), value, operations, options, checked, guard });
    if (elements.length >= 250) break;
  }
  const words: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange(); let current: Node | null, length = 0;
  while ((current = walker.nextNode()) && length < 6000) {
    const parent = current.parentElement, text = current.textContent?.trim();
    if (!parent || !text || parent.closest('script,style,noscript') || !visible(parent)) continue;
    range.selectNodeContents(current); const rect = range.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < innerHeight) { words.push(text); length += text.length; }
  }
  const text = words.join('\n').slice(0, 6000);
  const fingerprint = JSON.stringify([cache.documentId, location.href, document.title, text, scrollX, scrollY, innerWidth, innerHeight, elements]);
  return { url: location.href, title: document.title, text, documentId: cache.documentId, elements, fingerprint,
    scroll: { y: scrollY, height: document.documentElement.scrollHeight, viewport: innerHeight } };
}
