import { coverage } from '../coverage';
import { getAt, mergeData, setAt, type Json, type JsonObject, type PathSegment } from '../data';
import type { HostToWebview, TemplateInfo, WebviewToHost } from '../messages';
import { el } from './dom';
import { markInput, renderForm } from './form';
import { PdfPane } from './pdf';
import { pathKey, schemaPathOf, validateData, type FieldIssue } from '../validate';

declare function acquireVsCodeApi(): { postMessage(message: WebviewToHost): void };
const vscode = acquireVsCodeApi();
const send = (message: WebviewToHost) => vscode.postMessage(message);

const DEBOUNCE_MS = 600;

let template: TemplateInfo | undefined;
let data: JsonObject = {};
let dev = false;
let debounce: number | undefined;
/** Values the template can't read, by path key; recomputed on every render. */
let invalid = new Map<string, string>();
/** Messages from a failed render, by schema path, cleared when that field is edited. */
let serverErrors = new Map<string, string>();
/** The id of the last render request sent, and of the last one a refusal has made stale. */
let sentId = 0;
let staleUpTo = 0;

const pdf = new PdfPane();
const title = el('h1', {});
const status = el('span', { class: 'status' }, 'Starting…');
const banner = el('div', { class: 'banner error', role: 'alert', hidden: true });
const invalidBanner = el('div', { class: 'banner error', role: 'alert', hidden: true });
const infoLine = el('div', { class: 'banner info', hidden: true });
const warnings = el('div', { class: 'warnings' });
const coverageBox = el('details', { class: 'coverage' });
const formHost = el('div', { class: 'form-host' });
const dataPathLabel = el('span', { class: 'data-path' });

const button = (label: string, onClick: () => void, cls = 'secondary') => {
  const b = el('button', { type: 'button', class: cls }, label);
  b.addEventListener('click', onClick);
  return b;
};
const devBox = el('input', { type: 'checkbox', id: 'dev' });
devBox.addEventListener('change', () => {
  dev = devBox.checked;
  renderNow();
});

const toolbar = el(
  'div',
  { class: 'toolbar' },
  button('Render', () => renderNow(true), 'primary'),
  button('Load data…', () => send({ type: 'loadData' })),
  button('Save data', () => send({ type: 'saveData', data })),
  el('label', { class: 'dev', for: 'dev', title: 'Pass --dev to docmosis so missing fields are shown in the output' }, devBox, 'Dev mode'),
  button('Open PDF', () => send({ type: 'openPdf' })),
  status,
);

document.getElementById('app')!.append(
  el(
    'div',
    { class: 'layout' },
    el('section', { class: 'left' }, toolbar, invalidBanner, banner, infoLine, title, dataPathLabel, warnings, coverageBox, formHost),
    el('section', { class: 'right' }, pdf.element),
  ),
);

function renderNow(focus = false): void {
  window.clearTimeout(debounce);
  if (template) showInvalid(validateData(template.schema, data), focus);
  if (invalid.size > 0 && !dev) {
    discardRenders();
    status.textContent = 'Not rendered';
    return;
  }
  send({ type: 'render', id: ++sentId, data, dev });
}

/** Stops a render already started from showing a PDF or error for data that has since been refused. */
function discardRenders(): void {
  staleUpTo = sentId;
  send({ type: 'cancelRender' });
}

function showInvalid(issues: FieldIssue[], focus: boolean): void {
  invalid = new Map(issues.map((i) => [pathKey(i.path), i.message]));
  const count = invalid.size;
  invalidBanner.hidden = count === 0;
  invalidBanner.textContent =
    count === 0
      ? ''
      : `${count} ${count === 1 ? 'field needs' : 'fields need'} fixing${dev ? ' (rendering anyway in dev mode)' : ' before the template can render'}.`;
  markFields(focus);
}

/** Puts the current messages on the inputs, and optionally moves to the first one marked. */
function markFields(focus: boolean): void {
  let first: HTMLInputElement | undefined;
  for (const input of formHost.querySelectorAll<HTMLInputElement>('input[data-path]')) {
    const message = invalid.get(input.dataset.path!) ?? serverErrors.get(input.dataset.schemaPath!);
    markInput(input, message);
    if (message && !first) first = input;
  }
  if (focus && first) {
    first.scrollIntoView({ block: 'center' });
    first.focus();
  }
}

function scheduleRender(): void {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(renderNow, DEBOUNCE_MS);
}

function showInfo(text: string | undefined): void {
  infoLine.hidden = !text;
  infoLine.textContent = text ?? '';
}

function showError(text: string | undefined): void {
  banner.hidden = !text;
  banner.textContent = text ?? '';
}

function updateCoverage(): void {
  if (!template) return;
  const c = coverage(template.schema, data);
  const list = (items: string[]) =>
    items.length === 0 ? el('p', { class: 'none' }, 'None') : el('ul', {}, ...items.map((i) => el('li', {}, el('code', {}, i))));
  coverageBox.replaceChildren(
    el('summary', {}, `Coverage: ${c.missing.length} missing from data, ${c.unused.length} unused by template`),
    el('h3', {}, 'Template uses, data lacks'),
    list(c.missing),
    el('h3', {}, 'Data has, template never uses'),
    list(c.unused),
  );
}

function rebuildForm(): void {
  if (!template) return;
  const scroll = formHost.parentElement?.scrollTop ?? 0;
  formHost.replaceChildren(
    renderForm(template.schema, data, {
      set(path: PathSegment[], value: Json | undefined) {
        data = setAt(data, path, value);
        if (serverErrors.delete(schemaPathOf(path))) markFields(false);
        updateCoverage();
        scheduleRender();
      },
      addRow(path) {
        const rows = getAt(data, path);
        data = setAt(data, [...path, Array.isArray(rows) ? rows.length : 0], {});
        rebuildForm();
        updateCoverage();
        scheduleRender();
      },
      absolute: (path) => path,
      removeRow(path, index) {
        const rows = getAt(data, path);
        const rest = Array.isArray(rows) ? rows.filter((_, i) => i !== index) : [];
        data = setAt(data, path, rest.length > 0 ? rest : undefined);
        rebuildForm();
        updateCoverage();
        scheduleRender();
      },
    }),
  );
  if (formHost.parentElement) formHost.parentElement.scrollTop = scroll;
  invalid = new Map();
  serverErrors = new Map();
}

function applyTemplate(next: TemplateInfo): void {
  template = next;
  title.textContent = next.name;
  warnings.replaceChildren(...next.warnings.map((w) => el('div', { class: 'banner warn' }, w)));
  rebuildForm();
  updateCoverage();
}

window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      void pdf.useWorker(msg.workerUri).then(() => {
        data = msg.data;
        dev = msg.dev;
        devBox.checked = dev;
        dataPathLabel.textContent = `Data: ${msg.dataPath}`;
        showError(undefined);
        applyTemplate(msg.template);
        renderNow();
      });
      break;
    case 'template':
      showError(undefined);
      applyTemplate(msg.template);
      renderNow();
      break;
    case 'templateError':
      status.textContent = 'Template error';
      showError(msg.message);
      pdf.setPlaceholder(undefined);
      break;
    case 'data':
      data = mergeData(data, msg.data);
      rebuildForm();
      updateCoverage();
      showInfo('Data loaded and merged.');
      renderNow();
      break;
    case 'rendering':
      status.textContent = 'Rendering…';
      break;
    case 'pdf':
      if (msg.request <= staleUpTo) break;
      showError(undefined);
      serverErrors = new Map();
      markFields(false);
      status.textContent = `Rendered ${new Date().toLocaleTimeString()}`;
      void pdf.show(msg.bytes).catch((e: unknown) => showError(`Couldn't display the PDF: ${String(e)}`));
      break;
    case 'renderError':
      if (msg.request <= staleUpTo) break;
      status.textContent = 'Render failed';
      pdf.setPlaceholder(undefined);
      showError(msg.message);
      serverErrors = new Map(msg.fields.map((f) => [f, msg.reason ?? msg.message]));
      markFields(true);
      break;
    case 'invalid':
      staleUpTo = Math.max(staleUpTo, msg.request);
      showInvalid(msg.issues, false);
      status.textContent = 'Not rendered';
      break;
    case 'info':
      showInfo(msg.message);
      break;
  }
});

send({ type: 'ready' });
