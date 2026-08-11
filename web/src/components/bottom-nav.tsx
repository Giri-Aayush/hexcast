'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Bottom nav, per s3a: a dark pill on the light ground, four equal columns, the
 * active tab a light slab inside it.
 *
 * The design labels the fourth tab YOU, not ABOUT — it is the account view (s3h),
 * which is a different screen from the existing /about page. Pointing it at /about
 * until that view exists, so the label matches the design and the destination is
 * not a 404.
 */
const NAV_ITEMS = [
  { href: '/', label: 'Feed' },
  { href: '/saved', label: 'Saved' },
  { href: '/sources', label: 'Sources' },
  { href: '/about', label: 'You' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <div className="hx-navwrap">
      <nav className="hx-nav">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              data-nav={item.label.toLowerCase()}
              aria-current={active ? 'page' : undefined}
            >
              {item.label.toUpperCase()}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
