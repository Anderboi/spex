import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Settings, User2 } from "lucide-react";
import Link from "next/link";

const NAV_ITEMS = [
  { href: "/projects", label: "Проекты" },
  { href: "/materials", label: "Материалы" },
  { href: "/contacts", label: "Контакты" },
];

export function AppSidebar() {
  return (
    <Sidebar variant="inset">
      <SidebarHeader className="font-heading text-xl">Spex</SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV_ITEMS.map((item, index) => (
              <SidebarMenuItem key={index}>
                <SidebarMenuButton className="cursor-pointer hover:bg-bg-select" >
                  <Link href={item.href}>{item.label}</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup />
      </SidebarContent>
      <SidebarSeparator />
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="cursor-pointer">
              <User2 />
              Username
            </SidebarMenuButton>
            <SidebarMenuButton className="cursor-pointer">
              <Link href={"/settings"} className="flex">
                <Settings />
                Настройки
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
