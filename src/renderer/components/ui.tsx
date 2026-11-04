import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ComponentProps } from 'react'
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
const variants = cva('button', {
  variants: {
    variant: {
      default: 'button-default',
      ghost: 'button-ghost',
      outline: 'button-outline',
      danger: 'button-danger',
    },
    size: { default: '', icon: 'button-icon', sm: 'button-small' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof variants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(variants({ variant, size }), className)} {...props} />
}
