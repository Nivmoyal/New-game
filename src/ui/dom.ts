/** עזרי DOM קטנים — הממשק בנוי מ-DOM מעל הקנבס כדי לקבל RTL מלא וטקסט נגיש. */

export type ElOptions = {
  className?: string;
  text?: string;
  html?: string;
  title?: string;
  attrs?: Record<string, string>;
  onClick?: (ev: MouseEvent) => void;
  children?: (HTMLElement | null | undefined)[];
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.html !== undefined) node.innerHTML = opts.html;
  if (opts.title) node.title = opts.title;
  for (const [k, v] of Object.entries(opts.attrs ?? {})) node.setAttribute(k, v);
  if (opts.onClick) node.addEventListener('click', opts.onClick as EventListener);
  for (const child of opts.children ?? []) if (child) node.appendChild(child);
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function show(node: HTMLElement, visible: boolean): void {
  node.style.display = visible ? '' : 'none';
}

export function qs<T extends HTMLElement>(selector: string, root: ParentNode = document): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`אלמנט לא נמצא: ${selector}`);
  return node;
}
