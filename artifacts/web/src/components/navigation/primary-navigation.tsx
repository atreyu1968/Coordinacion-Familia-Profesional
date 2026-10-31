import { useEffect, useId, useState } from "react";
import { Link } from "wouter";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { DASHBOARD_ITEM, getNavigationGroups, navigationItemIsActive, type NavigationItem } from "./navigation-items";

interface PrimaryNavigationProps {
  role: string;
  location: string;
  expanded?: boolean;
  mobile?: boolean;
  onNavigate?: () => void;
}

export function PrimaryNavigation({ role, location, expanded = true, mobile = false, onNavigate }: PrimaryNavigationProps) {
  const groups = getNavigationGroups(role);
  const activeGroup = groups.find(group => group.items.some(item => navigationItemIsActive(location, item.path)))?.id;
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroup ?? null);
  const id = useId();
  useEffect(() => { setOpenGroup(activeGroup ?? null); }, [activeGroup, location, role]);

  const renderLink = (item: NavigationItem, nested = false) => {
    const active = navigationItemIsActive(location, item.path);
    const external = item.path.startsWith("https://");
    const className = `flex min-h-10 items-center gap-3 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${
      expanded ? nested ? "px-3 py-2" : "px-3 py-2.5" : "justify-center px-0 py-2.5"
    } ${
      mobile
        ? active ? "bg-primary text-primary-foreground focus-visible:ring-primary-foreground" : "text-foreground hover:bg-accent focus-visible:ring-primary"
        : active ? "bg-sidebar-primary text-sidebar-primary-foreground focus-visible:ring-sidebar-primary-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring"
    }`;
    const content = <>
      <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className={expanded ? "min-w-0 flex-1" : "sr-only"}>{item.label}</span>
      {expanded && external && <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />}
    </>;
    return external
      ? <a key={item.path} href={item.path} target="_blank" rel="noopener noreferrer" className={className}
        aria-label={`${item.label} (se abre en una pestaña nueva)`} title={item.label} onClick={onNavigate}>{content}</a>
      : <Link key={item.path} href={item.path} className={className} title={item.label}
        aria-current={active ? "page" : undefined} onClick={onNavigate}>{content}</Link>;
  };

  return <div className="space-y-1">
    <div className={`mb-2 border-b pb-2 ${mobile ? "border-border" : "border-sidebar-border"}`}>
      {renderLink(DASHBOARD_ITEM)}
    </div>
    {groups.map(group => {
      const open = openGroup === group.id && expanded;
      const active = activeGroup === group.id;
      const controls = `${id}-${group.id}`;
      const activeItem = group.items.find(item => navigationItemIsActive(location, item.path));
      return <section key={group.id} aria-label={group.label}>
        <button type="button" aria-expanded={open} aria-controls={controls}
          title={activeItem && !expanded ? `${group.label}: ${activeItem.label}` : group.label}
          onClick={() => setOpenGroup(current => current === group.id ? null : group.id)}
          className={`flex min-h-11 w-full items-center gap-3 rounded-md text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${
            expanded ? "px-3 py-2.5" : "justify-center px-0 py-2.5"
          } ${mobile
            ? active ? "bg-accent text-primary focus-visible:ring-primary" : "text-foreground hover:bg-accent focus-visible:ring-primary"
            : active ? "bg-sidebar-accent text-sidebar-foreground focus-visible:ring-sidebar-ring"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring"}`}>
          <group.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className={expanded ? "min-w-0 flex-1" : "sr-only"}>{group.label}</span>
          {expanded && <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />}
        </button>
        <div id={controls} hidden={!open} className={`mb-2 ml-5 mt-1 space-y-0.5 border-l pl-2 ${mobile ? "border-border" : "border-sidebar-border"}`}>
          {open && group.items.map(item => renderLink(item, true))}
        </div>
      </section>;
    })}
  </div>;
}
