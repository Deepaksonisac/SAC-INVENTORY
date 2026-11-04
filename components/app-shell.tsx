'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Menu,
  FileBarChart2,
  Package,
  PackageMinus,
  PackagePlus,
  ArrowUpFromLine,
  Building2,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/sites', label: 'Site List', icon: Building2 },
  { href: '/items', label: 'Item List', icon: Package },
  { href: '/inward', label: 'Stock IN', icon: PackagePlus },
  { href: '/outward', label: 'Stock OUT', icon: PackageMinus },
  { href: '/reports', label: 'Reports', icon: FileBarChart2 },
  { href: '/import-export', label: 'Import / Export', icon: ArrowUpFromLine },
]

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : 'text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-6 py-5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
        <Warehouse className="size-4" />
      </span>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-sidebar-primary">SiteStock ERP</p>
        <p className="text-xs text-sidebar-foreground/80">Site-wise inventory</p>
      </div>
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const current = NAV.find((n) => (n.href === '/' ? pathname === '/' : pathname.startsWith(n.href)))

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col overflow-y-auto bg-sidebar lg:flex">
        <Brand />
        <NavLinks pathname={pathname} />
      </aside>

      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur sm:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              render={
                <Button variant="outline" size="icon" className="lg:hidden" aria-label="Open navigation menu">
                  <Menu />
                </Button>
              }
            />
            <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0 text-sidebar-foreground">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetDescription className="sr-only">Application modules</SheetDescription>
              <Brand />
              <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <p className="truncate text-sm font-medium">{current?.label ?? 'SiteStock ERP'}</p>
          <p className="ml-auto hidden text-xs text-muted-foreground sm:block">
            Stock updates automatically with every IN and OUT entry
          </p>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  )
}
