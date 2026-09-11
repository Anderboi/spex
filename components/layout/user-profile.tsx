"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { STORAGE_KEY } from "@/lib/constants";
import { logout } from "@/actions/auth";
import { LogoutDialog } from "../auth/logout-dialog";
import { initials } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { redirect } from "next/navigation";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

interface UserProfileProps {
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  orgSlug: string;
}

export function UserProfile({ user, orgSlug }: UserProfileProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isLogoutDialogOpen, setIsLogoutDialogOpen] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // 2. Добавляем useTransition для обработки состояния загрузки Server Action
  const [isPending, startTransition] = useTransition();

  const menuRef = useRef<HTMLDivElement>(null);

  const userName = user?.name ?? user?.email;
  const userEmail = user?.email ?? "a.lebedeva@studio.ru";
  const initial = initials(userName || "user") || "@";
  const role = "Дизайнер"; //TODO: Добавить роли

  if (!user) return null;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogoutClick = () => {
    setIsPopoverOpen(false);

    const localDraft = localStorage.getItem(STORAGE_KEY);
    if (localDraft && localDraft !== "[]") {
      setHasUnsavedChanges(true);
    } else {
      setHasUnsavedChanges(false);
    }

    setIsLogoutDialogOpen(true);
  };

  // 3. Вызываем Server Action при подтверждении
  const handleConfirmLogout = () => {
    setIsLogoutDialogOpen(false);

    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error("Ошибка очистки localStorage:", e);
    }

    startTransition(async () => {
      try {
        await logout();
      } catch (error) {
        console.error("Ошибка при выходе из аккаунта:", error);
      }
    });
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem
        className="relative"
        // ref={menuRef}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            className="w-full hover:bg-bg-card rounded-lg cursor-pointer"
            render={<SidebarMenuButton size="lg" aria-label="Open user menu" />}
          >
            <Avatar>
              <AvatarImage
                className="bg-fg-brand"
                src={user.image || ""}
                alt="User avatar"
              />
              <AvatarFallback className="bg-bg-brand border border-fg-brand text-fg-brand">
                {initial}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 flex flex-col text-left min-w-0">
              <span className="text-sm font-semibold truncate">{userName}</span>
              <span className="text-xs text-fg-muted truncate">{role}</span>
            </div>
            <ChevronDown size={16} className="text-fg-muted" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="bg-bg w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={"right"}
            sideOffset={4}
          >
            <div>
              <div className="px-3 py-2 border-b border-border-subtle mb-1">
                <div className="text-[13px] font-semibold text-fg truncate">
                  {userName}
                </div>
                <div className="text-[11.5px] text-fg-muted truncate mt-0.5">
                  {userEmail}
                </div>
              </div>

              <button
                onClick={() => {
                  setIsPopoverOpen(false);
                  redirect(`${orgSlug}/settings/team`);
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 text-[13px] font-medium text-fg-secondary rounded-[8px] hover:bg-bg-select hover:text-fg transition-colors cursor-pointer text-left"
              >
                Профиль и студия
              </button>

              <div className="my-1 border-t border-border-subtle" />

              <button
                type="button"
                onClick={handleLogoutClick}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 text-[13px] font-medium text-fg-red rounded-[8px] hover:bg-bg-red-light transition-colors cursor-pointer text-left"
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M6 14H3.33C2.6 14 2 13.4 2 12.67V3.33C2 2.6 2.6 2 3.33 2H6M11.33 11.33L14.67 8l-3.34-3.33M6 8h8.67"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Выйти
              </button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>

      {/* Диалог подтверждения с состоянием загрузки */}
      <LogoutDialog
        isOpen={isLogoutDialogOpen}
        isPending={isPending}
        hasUnsavedChanges={hasUnsavedChanges}
        onClose={() => setIsLogoutDialogOpen(false)}
        onConfirm={handleConfirmLogout}
      />
    </SidebarMenu>
  );
}
