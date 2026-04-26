import * as Dialog from '@radix-ui/react-dialog';
import type { JSX, ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '5xl' | 'image';
  /**
   * When true, the title is hidden visually but still announced to assistive
   * tech. Use this when the modal renders its own custom header that already
   * displays the title text.
   */
  hideTitle?: boolean;
  /**
   * When true (default), the wrapper applies `p-6`. Set to false when the
   * children render their own header/content/footer with internal padding.
   */
  padded?: boolean;
  /**
   * Override the default content className entirely. When provided, no default
   * sizing/padding/background is applied; caller is responsible for layout.
   */
  contentClassName?: string;
}

const sizeClass: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '5xl': 'max-w-5xl',
  image: 'max-w-[90vw]',
};

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = 'md',
  hideTitle = false,
  padded = true,
  contentClassName,
}: ModalProps): JSX.Element {
  const defaultClass =
    `fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full ${sizeClass[size]} ` +
    `rounded-xl bg-white dark:bg-slate-800 shadow-2xl ${padded ? 'p-6' : ''}`;
  const finalClass = contentClassName ?? defaultClass;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
        <Dialog.Content aria-modal="true" className={finalClass}>
          {hideTitle ? (
            <Dialog.Title className="sr-only">{title}</Dialog.Title>
          ) : (
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          )}
          {description !== undefined ? (
            hideTitle ? (
              <Dialog.Description className="sr-only">{description}</Dialog.Description>
            ) : (
              <Dialog.Description className="text-sm text-slate-500 dark:text-slate-400">
                {description}
              </Dialog.Description>
            )
          ) : null}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
