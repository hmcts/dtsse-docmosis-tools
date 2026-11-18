// Fails `npm run typecheck` when lib/notify*.mjs and their hand-written .d.ts disagree.
//
// Checked:
// - every export of each .mjs is declared, and each module is assignable to its .d.ts;
// - each declared function, class constructor and class method exists and has exactly the
//   declared parameters (count, optionality and types) and return type;
// - each declared non-method member of a class instance exists and has exactly the declared type.
// Not checked:
// - exported constants beyond assignability, so a literal type passes where `string` is declared;
// - readonly modifiers, static members, overloads past the last one, and class members the .d.ts
//   leaves out;
// - the exported interfaces and type aliases, which have no runtime value to compare;
// - that a declaration describes what the code does: the .mjs JSDoc imports its types from the
//   .d.ts, so a declaration that is wrong but that the code compiles against still passes.
import * as notify from '../lib/notify.mjs';
import * as notifyNode from '../lib/notify-node.mjs';
import type * as NotifyDeclared from '../lib/notify.js';
import type * as NotifyNodeDeclared from '../lib/notify-node.js';

notify satisfies typeof NotifyDeclared;
notifyNode satisfies typeof NotifyNodeDeclared;

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Fn = (...args: never) => unknown;
type Ctor = abstract new (...args: never) => unknown;

/** `true`, or the names whose implementation differs from the declaration. */
type Report<Bad> = [Bad] extends [never] ? true : Bad;

// Tuple-wrapped checks keep a union such as `string | undefined` from being split up.
type SameFunction<I, D> = [I] extends [Fn]
    ? [D] extends [Fn]
        ? Equal<Parameters<I>, Parameters<D>> extends true
            ? Equal<ReturnType<I>, ReturnType<D>>
            : false
        : false
    : false;

type SameMember<I, D> = [D] extends [Fn] ? SameFunction<I, D> : Equal<I, D>;

// Optional members make the indexed mapped type include undefined, which isn't a mismatch.
/** The declared members of an instance type that are missing from the implementation or differ from it. */
type MemberMismatches<I, D> = Exclude<{ [K in keyof D]: K extends keyof I ? (SameMember<I[K], D[K]> extends true ? never : K) : K }[keyof D], undefined>;

type ExportMismatch<I, D> = [D] extends [Ctor]
    ? [I] extends [Ctor]
        ? Equal<ConstructorParameters<I>, ConstructorParameters<D>> extends true
            ? MemberMismatches<InstanceType<I>, InstanceType<D>>
            : 'constructor'
        : 'not a class'
    : [D] extends [Fn]
      ? SameFunction<I, D> extends true
          ? never
          : 'signature'
      : never;

type ModuleMismatches<I, D> = {
    [K in keyof D & keyof I]: [ExportMismatch<I[K], D[K]>] extends [never] ? never : `${K & string}: ${ExportMismatch<I[K], D[K]> & string}`;
}[keyof D & keyof I];

true satisfies Report<Exclude<keyof typeof notify, keyof typeof NotifyDeclared>>;
true satisfies Report<Exclude<keyof typeof notifyNode, keyof typeof NotifyNodeDeclared>>;
true satisfies Report<ModuleMismatches<typeof notify, typeof NotifyDeclared>>;
true satisfies Report<ModuleMismatches<typeof notifyNode, typeof NotifyNodeDeclared>>;
