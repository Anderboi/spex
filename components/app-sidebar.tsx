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

export function AppSidebar() {
  return (
    <Sidebar variant="inset">
      <SidebarHeader>SpecTrack</SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton className="cursor-pointer">
                <Link href={"/projects"}>Проекты</Link>
              </SidebarMenuButton>
              <SidebarMenuButton className="cursor-pointer">
                <Link href={"/materials"}>Материалы</Link>
              </SidebarMenuButton>
              <SidebarMenuButton className="cursor-pointer">
                <Link href={"/contacts"}>Контакты</Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
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
