// Fails `npm run typecheck` when lib/notify*.mjs and their hand-written .d.ts disagree.
import * as notify from '../lib/notify.mjs';
import * as notifyNode from '../lib/notify-node.mjs';
import type * as NotifyDeclared from '../lib/notify.js';
import type * as NotifyNodeDeclared from '../lib/notify-node.js';

notify satisfies typeof NotifyDeclared;
notifyNode satisfies typeof NotifyNodeDeclared;

/** `true` when every export is declared, else the undeclared names. */
type AllDeclared<Impl, Declared> = [Exclude<keyof Impl, keyof Declared>] extends [never] ? true : Exclude<keyof Impl, keyof Declared>;
true satisfies AllDeclared<typeof notify, typeof NotifyDeclared>;
true satisfies AllDeclared<typeof notifyNode, typeof NotifyNodeDeclared>;
