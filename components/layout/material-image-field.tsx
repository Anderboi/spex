"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { CloudUpload, Loader2, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { uploadMaterialImage } from "@/actions/materials";
import { ImageCropModal } from './image-crop-modal';

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
}: {
  imageUrl: string | null | undefined;
  orgSlug: string;
  onChange: (url: string | null) => void;
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

  const handleRemove = () => {
    setPreviewUrl(null);
    onChange(null);
  };

  return (
    <>
      <section className="bg-bg-card border-t border-b border-border-muted py-4 pl-4 pr-6">
        <div
          className="group relative aspect-square w-40 rounded-lg border border-border-muted overflow-hidden bg-bg-muted"
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
                sizes="160px"
                className="object-cover"
              />
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  aria-label="Заменить изображение"
                  className="flex items-center justify-center size-8 rounded-full bg-white/20 backdrop-blur-sm text-white hover:bg-white/30"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={handleRemove}
                  aria-label="Удалить изображение"
                  className="flex items-center justify-center size-8 rounded-full bg-white/20 backdrop-blur-sm text-white hover:bg-white/30"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex h-full w-full flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg text-center px-2 transition-colors"
              style={{
                borderColor: isDragging
                  ? "var(--border-brand, #999)"
                  : undefined,
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
        </div>
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
