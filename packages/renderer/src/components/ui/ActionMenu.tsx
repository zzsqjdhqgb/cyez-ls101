import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type JSX,
  type ReactNode,
  type SVGProps
} from 'react'
import { MoreHorizontal } from 'lucide-react'
import { IconButton } from './IconButton'
import styles from './ActionMenu.module.css'

type MenuIcon = ComponentType<SVGProps<SVGSVGElement>>

export function ActionMenu({
  children,
  disabled = false,
  label
}: {
  children: ReactNode
  disabled?: boolean
  label: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div className={styles.root} ref={root}>
      <IconButton
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        icon={MoreHorizontal}
        label={label}
        onClick={() => setOpen((current) => !current)}
      />
      {open ? (
        <div className={styles.menu} role="menu">
          {Children.map(children, (child) =>
            isValidElement<ActionMenuItemProps>(child)
              ? cloneElement(child, { closeMenu: () => setOpen(false) })
              : child
          )}
        </div>
      ) : null}
    </div>
  )
}

interface ActionMenuItemProps {
  children: string
  closeMenu?: () => void
  danger?: boolean
  disabled?: boolean
  icon: MenuIcon
  onSelect(): void
}

export function ActionMenuItem({
  children,
  closeMenu,
  danger = false,
  disabled = false,
  icon: Icon,
  onSelect
}: ActionMenuItemProps): JSX.Element {
  return (
    <button
      className={styles.item}
      data-danger={danger || undefined}
      disabled={disabled}
      role="menuitem"
      type="button"
      onClick={() => {
        closeMenu?.()
        onSelect()
      }}
    >
      <Icon aria-hidden="true" />
      <span>{children}</span>
    </button>
  )
}
