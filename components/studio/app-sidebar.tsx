"use client"

import { Library, Settings, Video } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import type { StudioMode } from "@/lib/studio-types"

interface AppSidebarProps {
  mode: StudioMode
  onLibrary: () => void
  onRecord: () => void
}

export function AppSidebar({ mode, onLibrary, onRecord }: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" onClick={onLibrary} tooltip="Voom">
              <span className="flex aspect-square size-8 items-center justify-center rounded-sm bg-sidebar-primary text-sidebar-primary-foreground">
                <span
                  role="img"
                  aria-label="Vercel"
                  className="size-4 bg-current"
                  style={{
                    mask: "url(https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/vercel/mono.svg) center / contain no-repeat",
                    WebkitMask: "url(https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/vercel/mono.svg) center / contain no-repeat",
                  }}
                />
              </span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">Voom</span>
                <span className="truncate text-xs text-sidebar-foreground/70">
                  Record better demos
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Studio</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={mode === "dashboard"}
                  onClick={onLibrary}
                  tooltip="Library"
                >
                  <Library />
                  <span>Library</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={mode === "setup" || mode === "recording"}
                  onClick={onRecord}
                  tooltip="New recording"
                >
                  <Video />
                  <span>New recording</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton disabled tooltip="Settings">
                  <Settings />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:justify-center">
          <span className="px-2 text-xs text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
            Appearance
          </span>
          <ThemeToggle />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
