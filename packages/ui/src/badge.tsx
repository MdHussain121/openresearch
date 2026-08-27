import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './utils';

export const badgeVariants = cva(
  'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1 select-none',
  {
    variants: {
      variant: {
        default: 'border border-border-default bg-sunken text-text-primary',
        secondary: 'border border-transparent bg-sunken text-text-secondary',
        destructive: 'border border-trust-danger/30 bg-trust-danger/10 text-trust-danger',
        warning: 'border border-trust-warning/30 bg-trust-warning/10 text-trust-warning',
        success: 'border border-trust-success/30 bg-trust-success/10 text-trust-success',
        accent: 'border border-accent/30 bg-accent/10 text-accent font-semibold',
        grounded: 'border border-trust-grounded/30 bg-trust-grounded/10 text-trust-grounded font-semibold',
        inference: 'border border-trust-inference/30 bg-trust-inference/10 text-trust-inference font-semibold',
        general: 'border border-border-default bg-surface text-text-tertiary',
        outline: 'border border-border-default text-text-primary',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
