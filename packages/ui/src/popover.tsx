import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from './utils';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-72 rounded-md border border-border-default bg-surface p-3 text-text-primary shadow-lg outline-none origin-[var(--radix-popover-content-transform-origin)] duration-150 data-[state=open]:duration-250 data-[state=closed]:duration-150 data-[state=open]:ease-smooth-out data-[state=closed]:ease-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=open]:will-change-transform',
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;
