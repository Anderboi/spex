import { DialogClose, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusMenu } from "../layout/status-menu";
import { InlineCode } from "../layout/inline-code";
import { MaterialImageField } from "@/components/layout/material-image-field";
import { SpecItem, SpecItemPatch } from "@/lib/types";
import { SpecStatus } from "@/lib/constants";
import { isLocked } from "@/lib/spec/status";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Eraser, MoreVertical, Share2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import SaveIndicator from "@/components/layout/save-indicator";
import { cn } from "@/lib/utils";

interface Props {
  item: SpecItem;
  onPatch: (patch: SpecItemPatch) => void;
  onCode: (code: string) => void;
  orgSlug: string;
  onStatus: (s: SpecStatus) => void;
  onDelete: () => void;
  onClear: () => void;
  onShare: () => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
  saveError: string | null;
  isCollapsed: boolean;
}

const DetailsHeader = ({
  item,
  onPatch,
  onCode,
  orgSlug,
  onStatus,
  onDelete,
  onClear,
  onShare,
  saveStatus,
  saveError,
  isCollapsed,
}: Props) => {
  return (
    <DialogHeader
      className={cn(
        "shrink-0 overflow-hidden border-b px-4 transition-[padding] duration-200",
        isCollapsed
          ? "py-2 max-md:py-1.5 max-md:pr-2 max-md:pl-3"
          : "py-4 max-md:py-2 max-md:pr-2 max-md:pl-3",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 ",
          "transition-[gap] duration-200",
          isCollapsed
            ? "gap-1 md:gap-2 items-center"
            : "gap-2 md:gap-3 items-start",
        )}
      >
        {item.imageUrl && (
          <div className="flex shrink-0 items-start">
            <MaterialImageField
              imageUrl={item.imageUrl}
              onChange={(url) => onPatch({ imageUrl: url ?? undefined })}
              orgSlug={orgSlug}
              className={cn(
                "transition-[width,height] duration-200",
                isCollapsed
                  ? "size-8 md:size-10 rounded-sm"
                  : "size-14 md:size-15 rounded-lg",
              )}
            />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 flex-row items-start gap-2">
            <DialogTitle
              className={cn(
                "min-w-0 flex-1 font-sans font-semibold wrap-break-word",
                "text-[16px] leading-5",
                isCollapsed ? "line-clamp-1" : "line-clamp-2",
              )}
            >
              <InlineCode
                code={item.code}
                locked={isLocked(item.status)}
                onCommit={onCode}
                className={cn(
                  "mr-2 shrink-0 rounded-sm bg-fg-brand px-2 text-bg py-0",
                  isCollapsed && "text-[10px]",
                )}
              />
              {item.name || (
                <span className="text-fg-muted font-normal">
                  Позиция не заполнена
                </span>
              )}
            </DialogTitle>
          </div>

          <div
            className={cn(
              "min-w-0 overflow-hidden transition-[max-height,opacity] duration-200",
              isCollapsed ? "max-h-0 opacity-0" : "max-h-6 opacity-100 md:mt-1",
            )}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-[11px] text-fg-muted uppercase">
              {item.brand && (
                <span className="min-w-0 truncate" title={item.brand}>
                  {item.brand}
                </span>
              )}
              {item.brand && item.product_type && (
                <span className="shrink-0">·</span>
              )}
              {item.product_type && (
                <span className="min-w-0 truncate" title={item.product_type}>
                  {item.product_type}
                </span>
              )}

              {item.brand && item.product_type && item.product_url && (
                <span className="shrink-0">·</span>
              )}

              {item.product_url && (
                <a
                  href={item.product_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Сайт производителя"
                  title={item.product_url}
                  className="shrink-0 text-fg-brand underline transition-colors hover:text-fg"
                >
                  Ссылка
                </a>
              )}
            </div>
          </div>
        </div>

        {/* //? Действия */}
        <div
          className={cn(
            "flex shrink-0 gap-x-1",
            !isCollapsed
              ? "flex-col items-end"
              : "flex-row-reverse items-center",
          )}
        >
          <div className={cn("flex shrink-0 items-center gap-1")}>
            <div className="hidden items-center md:flex">
              <SaveIndicator status={saveStatus} error={saveError} />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Действия с позицией"
                className="flex size-9 p-0 md:size-8 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
              >
                <MoreVertical className="size-5" />
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-56 bg-bg-card">
                <DropdownMenuItem
                  className="gap-2 text-[13px]"
                  onClick={onShare}
                >
                  <Share2 className="size-4" />
                  Поделиться
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  className="gap-2 text-[13px]"
                  onClick={onClear}
                >
                  <Eraser className="size-4" />
                  Очистить
                </DropdownMenuItem>

                <DropdownMenuItem
                  className="gap-2 text-[13px] text-fg-red"
                  onClick={onDelete}
                >
                  <Trash2 className="size-4" />
                  Удалить
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DialogClose
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Закрыть"
                  className="size-9 md:size-8 p-0"
                >
                  <X className="size-5" />
                </Button>
              }
            />
          </div>
          <div className="shrink-0">
            <StatusMenu
              item={item}
              onChange={onStatus}
              variant={isCollapsed ? "dot" : "chip"}
              filled={!isCollapsed}
              className={cn("w-fit", !isCollapsed ? "max-md:h-6" :"size-7")}
            />
          </div>
        </div>
      </div>
    </DialogHeader>
  );
};

export default DetailsHeader;
