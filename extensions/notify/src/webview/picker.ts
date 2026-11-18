import { el } from './dom';
import type { HostToPicker, PickerToHost, ProductOption, TemplateSummary } from '../messages';

declare function acquireVsCodeApi(): { postMessage(message: PickerToHost): void };
const vscode = acquireVsCodeApi();
const send = (message: PickerToHost) => vscode.postMessage(message);

const GROUPS: { type: TemplateSummary['type']; label: string }[] = [
  { type: 'email', label: 'Email' },
  { type: 'sms', label: 'Text message' },
  { type: 'letter', label: 'Letter' },
];

let products: ProductOption[] = [];
let templates: TemplateSummary[] = [];

const productSelect = el('select', { id: 'product' });
const productNote = el('div', { class: 'note' });
const filter = el('input', { type: 'search', id: 'filter', placeholder: 'Filter by name', disabled: true });
const templateSelect = el('select', { id: 'template', disabled: true });
const open = el('button', { type: 'button', class: 'primary', disabled: true }, 'Open');
const refresh = el('button', { type: 'button', class: 'secondary', title: 'Reload the templates from Notify', disabled: true }, 'Refresh');
const status = el('div', { class: 'key-status', role: 'status' });
const error = el('div', { class: 'banner error', role: 'alert', hidden: true });

productSelect.addEventListener('change', () => {
  if (!productSelect.value) return;
  showNote();
  send({ type: 'selectProduct', product: productSelect.value });
});
filter.addEventListener('input', () => fillTemplates());
// Chromium fires 'change' on every arrow key in a closed dropdown, so choosing a template only selects it.
templateSelect.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    openSelected();
  }
});
templateSelect.addEventListener('dblclick', () => openSelected());
open.addEventListener('click', () => openSelected());
refresh.addEventListener('click', () => send({ type: 'refresh' }));

document.getElementById('app')!.append(
  el(
    'div',
    { class: 'picker-form' },
    el('label', { for: 'product' }, 'Product'),
    productSelect,
    productNote,
    el('label', { for: 'filter' }, 'Template'),
    filter,
    templateSelect,
    el('div', { class: 'picker-actions' }, open, refresh),
    error,
    status,
  ),
);

function openSelected(): void {
  if (templateSelect.value) send({ type: 'openTemplate', template: templateSelect.value });
}

function showNote(): void {
  const product = products.find((p) => p.id === productSelect.value);
  productNote.textContent = product ? `${product.vault} / ${product.secret}${product.note ? ` (${product.note})` : ''}` : '';
}

function fillProducts(selected: string | undefined): void {
  productSelect.replaceChildren(
    el('option', { value: '', disabled: true, selected: !selected }, 'Choose a product…'),
    ...products.map((p) => el('option', { value: p.id, selected: p.id === selected }, p.label)),
  );
  showNote();
}

function fillTemplates(): void {
  const previous = templateSelect.value;
  const words = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = templates.filter((t) => words.every((w) => t.name.toLowerCase().includes(w)));
  const groups = GROUPS.map(({ type, label }) => {
    const items = shown.filter((t) => t.type === type).sort((a, b) => a.name.localeCompare(b.name));
    return items.length === 0
      ? undefined
      : el('optgroup', { label: `${label} (${items.length})` }, ...items.map((t) => el('option', { value: t.id, selected: t.id === previous }, t.name)));
  }).filter((g): g is HTMLOptGroupElement => g !== undefined);
  const prompt = shown.length === 0 ? (templates.length === 0 ? 'No templates' : 'No templates match') : 'Choose a template…';
  templateSelect.replaceChildren(el('option', { value: '', disabled: true, selected: !shown.some((t) => t.id === previous) }, prompt), ...groups);
  templateSelect.disabled = shown.length === 0;
  open.disabled = shown.length === 0;
}

function setLoading(text: string): void {
  templates = [];
  fillTemplates();
  filter.disabled = true;
  refresh.disabled = true;
  error.hidden = true;
  status.textContent = text;
}

window.addEventListener('message', (event: MessageEvent<HostToPicker>) => {
  if (!event.origin.startsWith('vscode-webview://')) return;
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      products = msg.products;
      fillProducts(msg.selected);
      if (!msg.selected) setLoading('');
      break;
    case 'loading':
      if (msg.product !== productSelect.value) {
        productSelect.value = msg.product;
        showNote();
      }
      setLoading(msg.message);
      break;
    case 'templates':
      if (msg.product !== productSelect.value) break;
      templates = msg.templates;
      filter.disabled = false;
      refresh.disabled = false;
      error.hidden = true;
      status.textContent = msg.status;
      fillTemplates();
      break;
    case 'error':
      if (msg.product !== productSelect.value) break;
      refresh.disabled = false;
      status.textContent = '';
      error.hidden = false;
      error.textContent = msg.message;
      break;
    case 'status':
      status.textContent = msg.message;
      break;
  }
});

send({ type: 'ready' });
