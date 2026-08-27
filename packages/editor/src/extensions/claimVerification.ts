import { Mark, mergeAttributes } from '@tiptap/core';

export interface ClaimVerificationOptions {
  HTMLAttributes: Record<string, any>;
  onInspectClaim?: (claimId: string, text: string, suggestedQuery?: string) => void;
  onDismissClaim?: (claimId: string) => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    claimVerification: {
      setClaimFlag: (attributes: {
        claimId: string;
        suggestedQuery?: string;
        isDismissed?: boolean;
      }) => ReturnType;
      unsetClaimFlag: () => ReturnType;
      dismissClaimFlag: (claimId: string) => ReturnType;
    };
  }
}

export const ClaimVerificationMark = Mark.create<ClaimVerificationOptions>({
  name: 'claimVerification',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      claimId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-claim-id') || null,
        renderHTML: (attrs) => (attrs.claimId ? { 'data-claim-id': attrs.claimId } : {}),
      },
      suggestedQuery: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-suggested-query') || null,
        renderHTML: (attrs) => (attrs.suggestedQuery ? { 'data-suggested-query': attrs.suggestedQuery } : {}),
      },
      isDismissed: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-claim-dismissed') === 'true',
        renderHTML: (attrs) => ({ 'data-claim-dismissed': attrs.isDismissed ? 'true' : 'false' }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-claim-flag]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, mark }) {
    const isDismissed = mark.attrs.isDismissed;
    const className = isDismissed
      ? 'claim-dismissed'
      : 'claim-unsupported border-b-2 border-dotted border-trust-warning hover:bg-trust-warning/10 transition-colors cursor-pointer rounded-xs px-0.5';

    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-claim-flag': 'true',
        'data-claim-id': mark.attrs.claimId,
        'data-suggested-query': mark.attrs.suggestedQuery,
        'data-claim-dismissed': String(mark.attrs.isDismissed),
        class: className,
        title: isDismissed
          ? 'Marked as intentional / Not a factual claim'
          : 'No supporting citation detected (Click to find sources)',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setClaimFlag:
        (attributes) =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes);
        },
      unsetClaimFlag:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
      dismissClaimFlag:
        (claimId: string) =>
        ({ tr, state, dispatch }) => {
          if (dispatch) {
            state.doc.descendants((node, pos) => {
              node.marks.forEach((mark) => {
                if (mark.type.name === 'claimVerification' && mark.attrs.claimId === claimId) {
                  const newMark = mark.type.create({
                    ...mark.attrs,
                    isDismissed: true,
                  });
                  tr.removeMark(pos, pos + node.nodeSize, mark.type);
                  tr.addMark(pos, pos + node.nodeSize, newMark);
                }
              });
            });
          }
          return true;
        },
    };
  },
});
