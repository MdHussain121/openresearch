import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded text-xs font-medium transition-[transform,background-color,border-color,color] duration-150 ease-smooth-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 select-none active:scale-[0.97] active:duration-50 @media(hover:hover){&:active{transition-duration:var(--duration-instant)}}',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-solid-fg hover:bg-accent-hover shadow-2xs',
        destructive: 'bg-trust-danger text-danger-solid-fg hover:bg-trust-danger/90 shadow-2xs',
        outline: 'border border-border-default bg-surface hover:bg-sunken text-text-primary',
        secondary: 'bg-sunken text-text-primary hover:bg-border-default/40',
        ghost: 'hover:bg-sunken text-text-secondary hover:text-text-primary',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3 py-1.5',
        sm: 'h-7 rounded px-2.5 text-[11px]',
        lg: 'h-10 rounded px-4 text-sm',
        icon: 'h-8 w-8 p-0',
        iconSm: 'h-7 w-7 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
