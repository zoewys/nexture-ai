/**
 * Select.tsx — Radix Select 封装组件
 *
 * 基于 @radix-ui/react-select 的薄封装，匹配项目暗色主题。
 * 提供键盘导航、无障碍支持、Portal 弹出层，替代原生 <select>。
 */

import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'

const EMPTY_SENTINEL = '__select_empty__'

interface SelectProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
  children: React.ReactNode
}

interface SelectItemProps {
  value: string
  children: React.ReactNode
  disabled?: boolean
}

export function Select({ value, onChange, placeholder, disabled, ariaLabel, children }: SelectProps) {
  const internalValue = value === '' ? EMPTY_SENTINEL : value
  const handleChange = (v: string) => onChange(v === EMPTY_SENTINEL ? '' : v)

  return (
    <SelectPrimitive.Root value={internalValue} onValueChange={handleChange} disabled={disabled}>
      <SelectPrimitive.Trigger className="select-trigger" aria-label={ariaLabel}>
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon className="select-icon">
          <ChevronDown size={12} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="select-content" position="popper" sideOffset={4}>
          <SelectPrimitive.ScrollUpButton className="select-scroll-btn">
            <ChevronUp size={12} />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="select-viewport">
            {children}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="select-scroll-btn">
            <ChevronDown size={12} />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

function Item({ value, children, disabled }: SelectItemProps) {
  const internalValue = value === '' ? EMPTY_SENTINEL : value
  return (
    <SelectPrimitive.Item className="select-item" value={internalValue} disabled={disabled}>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="select-item-check">
        <Check size={12} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

Select.Item = Item
