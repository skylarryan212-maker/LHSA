'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps } from 'react';

const baseContentClass = 'dropdown-content';
const baseItemClass = 'dropdown-item';

export function DropdownMenu(props: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
    return <DropdownMenuPrimitive.Root {...props} />;
}

export function DropdownMenuTrigger(props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
    return <DropdownMenuPrimitive.Trigger className="dropdown-trigger" {...props} />;
}

export function DropdownMenuContent({
    className,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
    return (
        <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content
                className={`${baseContentClass}${className ? ` ${className}` : ''}`}
                sideOffset={6}
                {...props}
            />
        </DropdownMenuPrimitive.Portal>
    );
}

export function DropdownMenuLabel({
    className,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
    return <DropdownMenuPrimitive.Label className={`dropdown-label${className ? ` ${className}` : ''}`} {...props} />;
}

export function DropdownMenuSeparator({
    className,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
    return <DropdownMenuPrimitive.Separator className={`dropdown-separator${className ? ` ${className}` : ''}`} {...props} />;
}

export function DropdownMenuItem({
    className,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
    return <DropdownMenuPrimitive.Item className={`${baseItemClass}${className ? ` ${className}` : ''}`} {...props} />;
}
