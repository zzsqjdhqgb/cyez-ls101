import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ComponentType,
  type JSX,
  type SVGProps
} from 'react'
import styles from './Button.module.css'

type ButtonIcon = ComponentType<SVGProps<SVGSVGElement>>

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'small' | 'medium'
  icon?: ButtonIcon
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'medium',
    icon: Icon,
    children,
    className,
    type = 'button',
    ...props
  },
  ref
): JSX.Element {
  const classes = [styles.button, styles[variant], styles[size], className]
    .filter(Boolean)
    .join(' ')

  return (
    <button ref={ref} className={classes} type={type} {...props}>
      {Icon ? <Icon aria-hidden="true" /> : null}
      {children}
    </button>
  )
})
