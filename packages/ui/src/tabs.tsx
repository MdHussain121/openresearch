import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from './utils';

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex h-9 items-center justify-center rounded-md bg-sunken p-1 text-text-secondary',
      className
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium transition-[background-color,color,box-shadow,transform] duration-150 ease-smooth-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-surface data-[state=active]:text-accent data-[state=active]:font-semibold data-[state=active]:shadow-2xs select-none',
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
