import type { ButtonHTMLAttributes, ComponentType, JSX, SVGProps } from 'react'
import { Tooltip } from './Tooltip'
import styles from './IconButton.module.css'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconComponent
  label: string
  size?: 'small' | 'medium'
  variant?: 'default' | 'ghost' | 'danger'
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

export function IconButton({
  icon: Icon,
  label,
  size = 'medium',
  variant = 'default',
  tooltipSide = 'top',
  className,
  type = 'button',
  disabled,
  ...props
}: IconButtonProps): JSX.Element {
  const classes = [styles.button, styles[size], styles[variant], className]
    .filter(Boolean)
    .join(' ')

  return (
    <Tooltip label={label} side={tooltipSide} disabled={disabled}>
      <button aria-label={label} className={classes} disabled={disabled} type={type} {...props}>
        <Icon aria-hidden="true" />
      </button>
    </Tooltip>
  )
}
