import { dataKey, findPlaceholders, formValues, notifyMarkdown, personalisationSchema, renderLocal, smsCount } from '@hmcts-cft/notify-tools';
import { mergeData, setAt, type Json, type JsonObject, type PathSegment } from '../data';
import { el } from './dom';
import { renderForm } from './form';
import type { EditorTemplate, EditorToHost, HostToEditor, PreviewContent } from '../messages';

declare function acquireVsCodeApi(): { postMessage(message: EditorToHost): void };
const vscode = acquireVsCodeApi();
const send = (message: EditorToHost) => vscode.postMessage(message);

const DEBOUNCE_MS = 600;
const TYPE_LABELS = { email: 'Email', sms: 'Text message', letter: 'Letter' } as const;

let template: EditorTemplate | undefined;
let data: JsonObject = {};
let mode: 'view' | 'edit' = 'view';
let subject = '';
let body = '';
/** The placeholder names the form was built for, to rebuild it only when they change. */
let formFor = '';
let sentId = 0;
let previewTimer: number | undefined;
let dataTimer: number | undefined;
let draftTimer: number | undefined;

const button = (label: string, onClick: () => void, cls = 'secondary', title?: string) => {
  const b = el('button', { type: 'button', class: cls, title }, label);
  b.addEventListener('click', onClick);
  return b;
};

const viewButton = button('View', () => setMode('view'));
const editButton = button('Edit', () => setMode('edit'));
viewButton.setAttribute('aria-pressed', 'true');
const retryButton = button('Retry', () => send({ type: 'retry' }), 'primary', 'Load the template from Notify again');
retryButton.hidden = true;
const status = el('span', { class: 'status' }, 'Loading…');
const toolbar = el(
  'div',
  { class: 'toolbar' },
  el('span', { class: 'mode-switch', role: 'group', 'aria-label': 'Mode' }, viewButton, editButton),
  button('Load data…', () => template && send({ type: 'loadData' })),
  button('Save data', () => template && send({ type: 'saveData', data })),
  button('Open in Notify', () => send({ type: 'openInNotify' }), 'secondary', 'Open the template in the GOV.UK Notify web app'),
  retryButton,
  status,
);
const staleBanner = el('div', { class: 'banner warn', role: 'status', hidden: true });
const errorBanner = el('div', { class: 'banner error', role: 'alert', hidden: true });
const infoLine = el('div', { class: 'banner info', hidden: true });
const title = el('h1', {});
const metaLine = el('div', { class: 'data-path' });

const subjectInput = el('input', { type: 'text', id: 'subject', spellcheck: 'true' });
const subjectRow = el('div', { class: 'row' }, el('label', { for: 'subject' }, 'Subject'), subjectInput);
const bodyInput = el('textarea', { id: 'body', rows: '16', spellcheck: 'true' });
const copySubject = button('Copy subject', () => send({ type: 'copy', what: 'subject', text: subject }));
const editBox = el(
  'div',
  { class: 'edit-box', hidden: true },
  subjectRow,
  el('div', { class: 'row' }, el('label', { for: 'body' }, 'Body'), bodyInput),
  el(
    'div',
    { class: 'toolbar edit-toolbar' },
    copySubject,
    button('Copy body', () => send({ type: 'copy', what: 'body', text: body })),
    button('Show diff', () => send({ type: 'showDiff', subject, body }), 'secondary', "Compare Notify's version with the draft"),
    button('Revert to Notify version', revert),
  ),
);
const dataPathLabel = el('div', { class: 'data-path' });
const formHost = el('div', { class: 'form-host' });

const previewLabel = el('div', { class: 'preview-label' });
const previewSubject = el('div', { class: 'preview-subject', hidden: true });
const previewBody = el('div', { class: 'preview-body' });
const smsInfo = el('div', { class: 'sms-info', hidden: true });

document.getElementById('app')!.append(
  el(
    'div',
    { class: 'layout' },
    el(
      'section',
      { class: 'left' },
      toolbar,
      staleBanner,
      errorBanner,
      infoLine,
      title,
      metaLine,
      editBox,
      el('h3', {}, 'Personalisation'),
      dataPathLabel,
      formHost,
    ),
    el('section', { class: 'right notify-preview' }, previewLabel, previewSubject, previewBody, smsInfo),
  ),
);

subjectInput.addEventListener('input', () => {
  subject = subjectInput.value;
  edited();
});
bodyInput.addEventListener('input', () => {
  body = bodyInput.value;
  edited();
});

function show(node: HTMLElement, text: string | undefined): void {
  node.hidden = !text;
  node.textContent = text ?? '';
}

/** The subject and body the form and preview follow: the draft in Edit mode, Notify's version in View mode. */
function source(): { subject: string; body: string } {
  return mode === 'edit' || !template ? { subject, body } : { subject: template.subject, body: template.body };
}

function rebuildForm(force = false): void {
  const { subject: s, body: b } = source();
  const placeholders = findPlaceholders(s, b);
  const names = placeholders.map((p) => `${p.name}:${p.conditional}`).join('\n');
  if (!force && names === formFor) return;
  formFor = names;
  if (placeholders.length === 0) {
    formHost.replaceChildren(el('p', { class: 'none' }, 'This template has no personalisation.'));
    return;
  }
  formHost.replaceChildren(
    renderForm(personalisationSchema(placeholders), formValues(placeholders, data), {
      set([name, ...rest]: PathSegment[], value: Json | undefined) {
        data = setAt(data, [dataKey(data, String(name)), ...rest], value);
        dataEdited();
      },
      addRow: () => undefined,
      removeRow: () => undefined,
      absolute: (path) => path,
    }),
  );
}

function dataEdited(): void {
  window.clearTimeout(dataTimer);
  dataTimer = window.setTimeout(() => send({ type: 'dataChanged', data }), DEBOUNCE_MS);
  refreshPreview(false);
}

function edited(): void {
  rebuildForm();
  showLocal();
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => send({ type: 'saveDraft', subject, body }), DEBOUNCE_MS);
}

function refreshPreview(now: boolean): void {
  window.clearTimeout(previewTimer);
  if (mode === 'edit') {
    showLocal();
    return;
  }
  if (now) requestPreview();
  else previewTimer = window.setTimeout(requestPreview, DEBOUNCE_MS);
}

function requestPreview(): void {
  window.clearTimeout(previewTimer);
  if (!template) return;
  send({ type: 'preview', id: ++sentId, data });
}

const ALLOWED_URL = /^(https?:|mailto:|#)/i;
const BLOCKED_TAGS = 'script, style, iframe, frame, object, embed, form, input, button, link, meta, base';

/** Shows HTML from Notify or the local renderer with anything active removed. */
function setHtml(target: HTMLElement, html: string): void {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll(BLOCKED_TAGS).forEach((node) => node.remove());
  for (const node of doc.body.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name === 'src') && !ALLOWED_URL.test(attr.value.trim()))) node.removeAttribute(attr.name);
    }
  }
  target.replaceChildren(...[...doc.body.childNodes].map((n) => document.importNode(n, true)));
}

function showSms(text: string): void {
  previewBody.className = 'preview-body sms';
  previewBody.textContent = text;
  const count = smsCount(text);
  show(
    smsInfo,
    `${count.characters} characters, ${count.fragments} ${count.fragments === 1 ? 'text message' : 'text messages'}${count.unicode ? ' (contains characters outside the GSM alphabet, so 70 per message)' : ''}`,
  );
}

function showLocal(label = "Approximate: Notify's own preview is authoritative."): void {
  if (!template) return;
  const { subject: s, body: b } = source();
  const local = renderLocal(template.type, s, b, data);
  previewLabel.textContent = label;
  previewLabel.classList.add('approximate');
  show(previewSubject, local.subject);
  if (local.text !== undefined) {
    showSms(local.text);
  } else {
    previewBody.className = `preview-body ${template.type}`;
    setHtml(previewBody, local.html ?? '');
    show(smsInfo, undefined);
  }
}

function showNotify(preview: PreviewContent, missing: string[]): void {
  if (!template) return;
  previewLabel.classList.remove('approximate');
  previewLabel.textContent = missing.length
    ? `Notify preview. Not filled in, so shown as written: ${missing.map((m) => `((${m}))`).join(', ')}`
    : 'Notify preview';
  show(previewSubject, preview.subject);
  if (template.type === 'sms') {
    showSms(preview.body);
    return;
  }
  show(smsInfo, undefined);
  previewBody.className = `preview-body ${template.type}`;
  if (template.type === 'letter') previewBody.textContent = preview.body;
  else setHtml(previewBody, preview.html ?? notifyMarkdown(preview.body));
}

function setMode(next: 'view' | 'edit'): void {
  if (!template) return;
  mode = next;
  viewButton.setAttribute('aria-pressed', String(next === 'view'));
  editButton.setAttribute('aria-pressed', String(next === 'edit'));
  viewButton.className = next === 'view' ? 'primary' : 'secondary';
  editButton.className = next === 'edit' ? 'primary' : 'secondary';
  editBox.hidden = next !== 'edit';
  if (next === 'edit') {
    window.clearTimeout(previewTimer);
    sentId++;
    send({ type: 'cancelPreview' });
    status.textContent = 'Editing a local draft';
  }
  rebuildForm();
  refreshPreview(true);
}

function revert(): void {
  if (!template) return;
  window.clearTimeout(draftTimer);
  subject = subjectInput.value = template.subject;
  body = bodyInput.value = template.body;
  show(staleBanner, undefined);
  send({ type: 'discardDraft' });
  rebuildForm();
  showLocal();
}

window.addEventListener('message', (event: MessageEvent<HostToEditor>) => {
  if (!event.origin.startsWith('vscode-webview://')) return;
  const msg = event.data;
  switch (msg.type) {
    case 'init': {
      template = msg.template;
      data = msg.data;
      subject = msg.draft?.subject ?? msg.template.subject;
      body = msg.draft?.body ?? msg.template.body;
      subjectInput.value = subject;
      bodyInput.value = body;
      subjectRow.hidden = msg.template.type === 'sms';
      copySubject.hidden = msg.template.type === 'sms';
      title.textContent = msg.template.name;
      metaLine.textContent = `${TYPE_LABELS[msg.template.type]} template, version ${msg.template.version}, ${msg.product.label}`;
      dataPathLabel.textContent = `Data: ${msg.dataPath}`;
      show(errorBanner, undefined);
      retryButton.hidden = true;
      show(
        staleBanner,
        msg.staleDraft && msg.draft
          ? `Notify's template has changed since this draft was started: the draft is based on version ${msg.draft.baseVersion}, Notify has version ${msg.template.version}. Show diff to compare, or Revert to start again from Notify's version.`
          : undefined,
      );
      if (msg.draft) show(infoLine, 'Opened your saved draft. Notify still has its own version until you paste the draft in.');
      formFor = '';
      setMode(msg.draft ? 'edit' : 'view');
      break;
    }
    case 'loading':
      status.textContent = 'Loading…';
      retryButton.hidden = true;
      show(errorBanner, undefined);
      break;
    case 'loadError':
      status.textContent = "Couldn't load";
      retryButton.hidden = false;
      show(errorBanner, msg.message);
      break;
    case 'data':
      data = mergeData(data, msg.data);
      rebuildForm(true);
      show(infoLine, 'Data loaded and merged.');
      send({ type: 'dataChanged', data });
      refreshPreview(true);
      break;
    case 'previewing':
      if (mode === 'view') status.textContent = 'Previewing…';
      break;
    case 'preview':
      if (mode !== 'view' || msg.request !== sentId) break;
      show(errorBanner, undefined);
      status.textContent = `Previewed ${new Date().toLocaleTimeString()}`;
      showNotify(msg.preview, msg.missing);
      break;
    case 'previewError':
      if (mode !== 'view' || msg.request !== sentId) break;
      status.textContent = 'Notify preview failed';
      show(errorBanner, msg.message);
      showLocal("Notify's preview failed, so this is an approximate local preview.");
      break;
    case 'info':
      show(infoLine, msg.message);
      break;
  }
});

send({ type: 'ready' });
