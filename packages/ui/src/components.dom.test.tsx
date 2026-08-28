// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import React, { createElement } from 'react';
import { Badge } from './badge';
import { Button } from './button';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from './dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from './dropdown-menu';
import { Popover, PopoverTrigger, PopoverContent } from './popover';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
} from './select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './tooltip';

describe('UI Primitives Component Test Suite', () => {
  function renderIntoDom(element: React.ReactElement) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    flushSync(() => {
      root.render(element);
    });
    return {
      container,
      cleanup: () => {
        root.unmount();
        container.remove();
      },
    };
  }

  describe('Badge component', () => {
    it('renders default and specialized variants', () => {
      const variants = [
        'default',
        'secondary',
        'destructive',
        'warning',
        'success',
        'accent',
        'grounded',
        'inference',
        'general',
        'outline',
      ] as const;

      for (const variant of variants) {
        const { container, cleanup } = renderIntoDom(
          <Badge variant={variant} className="custom-class">
            {variant}
          </Badge>
        );
        const el = container.firstElementChild;
        expect(el?.textContent).toBe(variant);
        expect(el?.className).toContain('custom-class');
        cleanup();
      }
    });
  });

  describe('Button component', () => {
    it('renders all size variants and asChild', () => {
      const sizes = ['default', 'sm', 'lg', 'icon', 'iconSm'] as const;
      for (const size of sizes) {
        const { container, cleanup } = renderIntoDom(
          <Button size={size}>Size {size}</Button>
        );
        const btn = container.querySelector('button');
        expect(btn?.textContent).toBe(`Size ${size}`);
        cleanup();
      }

      const { container, cleanup } = renderIntoDom(
        <Button asChild>
          <a href="/test">Link Button</a>
        </Button>
      );
      const link = container.querySelector('a');
      expect(link?.getAttribute('href')).toBe('/test');
      expect(link?.textContent).toBe('Link Button');
      cleanup();
    });
  });

  describe('Dialog component hierarchy', () => {
    it('renders Dialog with Title, Description, and Footer', () => {
      const { container, cleanup } = renderIntoDom(
        <Dialog open={true}>
          <DialogTrigger asChild>
            <Button>Open</Button>
          </DialogTrigger>
          <DialogContent hideClose={false}>
            <DialogHeader>
              <DialogTitle>Dialog Title</DialogTitle>
              <DialogDescription>Dialog Description</DialogDescription>
            </DialogHeader>
            <p>Body Content</p>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button>Confirm</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );

      expect(document.body.textContent).toContain('Dialog Title');
      expect(document.body.textContent).toContain('Dialog Description');
      expect(document.body.textContent).toContain('Body Content');
      expect(document.body.textContent).toContain('Cancel');

      cleanup();
    });
  });

  describe('DropdownMenu component hierarchy', () => {
    it('renders DropdownMenu components', () => {
      const { container, cleanup } = renderIntoDom(
        <DropdownMenu open={true}>
          <DropdownMenuTrigger asChild>
            <Button>Menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem inset>
              <span>Copy</span>
              <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem checked={true}>
              Check Item
            </DropdownMenuCheckboxItem>
            <DropdownMenuRadioGroup value="opt1">
              <DropdownMenuRadioItem value="opt1">
                Radio Option 1
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSub open={true}>
              <DropdownMenuSubTrigger inset>Submenu</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Sub Item 1</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      expect(document.body.textContent).toContain('Actions');
      expect(document.body.textContent).toContain('Copy');
      expect(document.body.textContent).toContain('⌘C');
      expect(document.body.textContent).toContain('Check Item');
      expect(document.body.textContent).toContain('Radio Option 1');
      expect(document.body.textContent).toContain('Submenu');
      expect(document.body.textContent).toContain('Sub Item 1');

      cleanup();
    });
  });

  describe('Popover component', () => {
    it('renders Popover content when open', () => {
      const { container, cleanup } = renderIntoDom(
        <Popover open={true}>
          <PopoverTrigger asChild>
            <Button>Trigger Popover</Button>
          </PopoverTrigger>
          <PopoverContent>
            <div>Popover Body</div>
          </PopoverContent>
        </Popover>
      );

      expect(document.body.textContent).toContain('Popover Body');
      cleanup();
    });
  });

  describe('Select component hierarchy', () => {
    it('renders Select content and options when open', () => {
      const { container, cleanup } = renderIntoDom(
        <Select open={true} value="option1">
          <SelectTrigger>
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Options</SelectLabel>
              <SelectSeparator />
              <SelectItem value="option1">Option 1</SelectItem>
              <SelectItem value="option2">Option 2</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      );

      expect(document.body.textContent).toContain('Options');
      expect(document.body.textContent).toContain('Option 1');
      cleanup();
    });
  });

  describe('Tabs component hierarchy', () => {
    it('renders tabs with active content switching', () => {
      const { container, cleanup } = renderIntoDom(
        <Tabs defaultValue="tab1">
          <TabsList>
            <TabsTrigger value="tab1">Tab 1</TabsTrigger>
            <TabsTrigger value="tab2">Tab 2</TabsTrigger>
          </TabsList>
          <TabsContent value="tab1">Tab 1 Content</TabsContent>
          <TabsContent value="tab2">Tab 2 Content</TabsContent>
        </Tabs>
      );

      expect(container.textContent).toContain('Tab 1');
      expect(container.textContent).toContain('Tab 1 Content');
      cleanup();
    });
  });

  describe('Tooltip component hierarchy', () => {
    it('renders tooltip trigger and content structure', () => {
      const { container, cleanup } = renderIntoDom(
        <TooltipProvider>
          <Tooltip open={true}>
            <TooltipTrigger asChild>
              <Button>Hover Me</Button>
            </TooltipTrigger>
            <TooltipContent>Helpful tooltip text</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      expect(document.body.textContent).toContain('Helpful tooltip text');
      cleanup();
    });
  });
});
