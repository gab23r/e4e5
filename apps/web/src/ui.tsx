/** Small UI kit: icons, buttons, page header, menus, tabs, empty states. Styles: styles.css. */
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { t } from './i18n';

// --- Icons (24×24, stroke) ------------------------------------------------------------------------
const paths = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  book: 'M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5zM4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
  back: 'M15 18l-6-6 6-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  sync: 'M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5',
  chevron: 'M9 18l6-6-6-6',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  play: 'M7 4v16l13-8z',
  pause: 'M9 5v14M15 5v14',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  games: 'M4 4h16v16H4zM4 12h16M12 4v16',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z',
  close: 'M18 6 6 18M6 6l12 12',
  pencil: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  level: 'M5 20v-6M12 20V4M19 20v-10M3 20h18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.35-4.35',
  /** A board under a magnifier: the analysis (Lichess at my level + Stockfish). */
  analysis: 'M3 3h11v11H3zM3 8.5h11M8.5 3v11M16 20a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM18.9 18.9 22 22',
  /** Give up (Abandon). */
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  replay: 'M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5',
  /** A light bulb (Indice). */
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  engine: 'M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM10 10h4v4h-4zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3',
} as const;
export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={name === 'more' || name === 'grip' ? 3.2 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

// --- Buttons ---------------------------------------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
interface ButtonProps {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  icon?: IconName;
  /** Internal link (react-router). */
  to?: string;
  /** External / full-page link. */
  href?: string;
  title?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: () => void;
  children?: ReactNode;
  className?: string;
}

export function Button({ variant = 'secondary', size = 'md', block, icon, to, href, title, disabled, type = 'button', onClick, children, className = '' }: ButtonProps) {
  const cls = ['btn', variant !== 'secondary' && `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', !children && 'btn-icon', className]
    .filter(Boolean)
    .join(' ');
  const content = (
    <>
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}
      {children}
    </>
  );
  if (to) return <Link className={cls} to={to} title={title} aria-disabled={disabled || undefined}>{content}</Link>;
  if (href) return <a className={cls} href={href} title={title} aria-disabled={disabled || undefined}>{content}</a>;
  return (
    <button className={cls} type={type} title={title} aria-label={!children ? title : undefined} disabled={disabled} onClick={onClick}>
      {content}
    </button>
  );
}

// --- Menu (⋯) ------------------------------------------------------------------------------------
export interface MenuItem {
  label: string;
  onClick?: () => void;
  to?: string;
  danger?: boolean;
}

/** A button opening a list of actions. `trigger`: custom button content (default ⋯). */
export function Menu({ items, label, trigger, title = t('Plus d’actions', 'More actions') }: { items: MenuItem[]; label?: ReactNode; trigger?: ReactNode; title?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      {trigger ? (
        <button className="avatar" title={title} aria-label={title} aria-expanded={open} onClick={() => setOpen(!open)}>{trigger}</button>
      ) : (
        <button className="btn btn-ghost btn-icon" title={title} aria-label={title} aria-expanded={open} onClick={(e) => (e.preventDefault(), setOpen(!open))}>
          <Icon name="more" />
        </button>
      )}
      {open && (
        <div className="menu-list" role="menu">
          {label && <div className="menu-label">{label}</div>}
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              className={item.danger ? 'danger' : ''}
              onClick={() => {
                setOpen(false);
                if (item.to) navigate(item.to);
                item.onClick?.();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Page header -----------------------------------------------------------------------------------
/**
 * The slot of the app bar where the page header goes on a phone (the bar shows the page's title
 * instead of the app's name). Given by App.
 */
export const AppbarSlot = createContext<HTMLElement | null>(null);

const PHONE = '(max-width: 899px)';
/** The screen is narrow (phone layout: tab bar at the bottom, page title in the app bar). */
export function usePhone() {
  return useSyncExternalStore(
    (onChange) => {
      const q = window.matchMedia(PHONE);
      q.addEventListener('change', onChange);
      return () => q.removeEventListener('change', onChange);
    },
    () => window.matchMedia(PHONE).matches,
  );
}

type PageHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Where the back button leads; with `backInHistory`, only when there is no previous screen in the app. */
  back?: string;
  /** The back button returns to the previous screen (as the browser's back), whatever it was. */
  backInHistory?: boolean;
  actions?: ReactNode;
  menu?: MenuItem[];
};

export function PageHeader(props: PageHeaderProps) {
  const slot = useContext(AppbarSlot);
  const phone = usePhone();
  return phone && slot ? createPortal(<PageHeaderContent {...props} />, slot) : <PageHeaderContent {...props} />;
}

function PageHeaderContent({ title, subtitle, back, backInHistory, actions, menu }: PageHeaderProps) {
  const navigate = useNavigate();
  // 'default': this screen was opened first (link, reload), there is nothing to go back to in the app.
  const hasPrevious = useLocation().key !== 'default';
  return (
    <header className="page-header">
      {backInHistory && hasPrevious ? (
        <Button variant="ghost" icon="back" onClick={() => navigate(-1)} title={t('Retour', 'Back')} className="back" />
      ) : (
        back && <Button variant="ghost" icon="back" to={back} title={t('Retour', 'Back')} className="back" />
      )}
      <div className="titles">
        <h2>{title}</h2>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      {(actions || menu) && (
        <div className="actions">
          {actions}
          {menu && menu.length > 0 && <Menu items={menu} />}
        </div>
      )}
    </header>
  );
}

// --- Tabs / segmented control ----------------------------------------------------------------------
export function Tabs<T extends string>({ tabs, value, onChange, block }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (id: T) => void; block?: boolean }) {
  return (
    <div className={`tabs ${block ? 'block' : ''}`} role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} className={t.id === value ? 'active' : ''} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// --- Empty state -----------------------------------------------------------------------------------
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <div>{children}</div>}
      {action}
    </div>
  );
}

/** On/off switch (e.g. a repertoire in training or paused). */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} title={label} disabled={disabled} className={`switch-toggle ${on ? 'on' : ''}`} onClick={onChange}>
      <span className="knob" />
    </button>
  );
}

/** Plural in the current language (i18n). */
export { plural } from './i18n';
