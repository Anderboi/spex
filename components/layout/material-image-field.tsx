"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { CloudUpload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { uploadMaterialImage } from "@/actions/materials";
import { cn } from "@/lib/utils";
import { ImageCropModal } from './image-crop-modal';
import IconButtonBlock from './icon-button-block';

const MAX_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

function validateFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return "Поддерживаются только JPG, PNG и WebP";
  }
  if (file.size > MAX_SIZE) {
    return "Файл больше 5 МБ";
  }
  return null;
}

export function MaterialImageField({
  imageUrl,
  orgSlug,
  onChange,
  className,
}: {
  imageUrl: string | null | undefined;
  orgSlug: string;
  onChange: (url: string | null) => void;
  /** Размер поля: по умолчанию 160px, хедер детализации ужимает его на телефоне. */
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null); // optimistic local preview
  const [cropSrc, setCropSrc] = useState<string | null>(null); // raw file data-url awaiting crop
  const [pendingFileName, setPendingFileName] = useState("image.jpg");

  const displayUrl = previewUrl ?? imageUrl ?? null;

  const openCropForFile = (file: File) => {
    const error = validateFile(file);
    if (error) {
      toast.error(error);
      return;
    }
    setPendingFileName(file.name.replace(/\.[^.]+$/, ".jpg"));
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) openCropForFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) openCropForFile(file);
  };

  const uploadBlob = async (blob: Blob) => {
    setCropSrc(null);

    const localUrl = URL.createObjectURL(blob);
    setPreviewUrl(localUrl); // мгновенный отклик, до ответа сервера
    setIsUploading(true);

    try {
      const fd = new FormData();
      fd.append("file", blob, pendingFileName);
      const res = await uploadMaterialImage(orgSlug, fd);
      if (!res.success) {
        toast.error(res.error);
        setPreviewUrl(null);
        return;
      }
      onChange(res.url);
    } catch {
      toast.error("Не удалось загрузить изображение");
      setPreviewUrl(null);
    } finally {
      setIsUploading(false);
      URL.revokeObjectURL(localUrl);
    }
  };

  const handleReplace = () => inputRef.current?.click();

  const handleRemove = () => {
    setPreviewUrl(null);
    onChange(null);
  };

  return (
    <>
      <section
        className={cn(
          "group relative aspect-square rounded-lg overflow-hidden",
          className ?? "size-30",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleInputChange}
        />

        {displayUrl ? (
          <>
            <Image
              alt="Изображение материала"
              src={displayUrl}
              fill
              sizes="120px"
              className="object-cover"
            />
            {/* «Редактировать» открывает выбор файла, «Удалить» — очищает:
                  раньше обе кнопки вызывали handleRemove, и правка изображения
                  работала как удаление. */}
            <IconButtonBlock onClick={handleReplace} onDelete={handleRemove} className="max-md:hidden"/>
          </>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex h-full w-full flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg text-center px-2 transition-colors"
            style={{
              borderColor: isDragging ? "var(--border-brand, #999)" : undefined,
            }}
          >
            <CloudUpload size={20} className="text-fg-muted" />
            <span className="text-[11px] text-fg-muted">
              JPG/PNG/WebP до 5 МБ
            </span>
          </button>
        )}

        {isUploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 className="size-5 animate-spin text-white" />
          </div>
        )}
      </section>

      {cropSrc && (
        <ImageCropModal
          open
          src={cropSrc}
          fileName={pendingFileName}
          onCancel={() => setCropSrc(null)}
          onConfirm={uploadBlob}
        />
      )}
    </>
  );
}
